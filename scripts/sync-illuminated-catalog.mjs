#!/usr/bin/env node

/**
 * Import the public-safe Illuminated Letters catalog into private Story Scrolls
 * storage. The catalog contains preview derivatives only: no ZIP, original,
 * or raw glyph-asset path is accepted or written here.
 */

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_CATALOG_URL =
  "https://illuminatedletters.corydev.com/catalog/illuminated-letter-catalog.v1.json";
const EXPECTED_ORIGIN = "https://illuminatedletters.corydev.com";
const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const MAX_MANIFEST_BYTES = 12 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 6 * 1024 * 1024;

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultCacheDir = path.resolve(
  process.env.STORYSCROLLS_ILLUMINATED_CATALOG_DIR
    || path.resolve(projectRoot, "..", "..", "_data", "thestoryscrolls", "illuminated-catalog"),
);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isSafePreviewUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.origin === EXPECTED_ORIGIN
      && url.protocol === "https:"
      && /\/illuminated-alphabet\/assets\/(?:sample\.png|previews\/[a-z0-9][a-z0-9._-]*\.webp)$/i.test(url.pathname)
      && !/\.zip$/i.test(url.pathname)
      && !/\/letters\//i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function assertHash(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error(`${label} needs a SHA-256 checksum.`);
  }
}

export function validateCatalog(value) {
  if (!value || typeof value !== "object" || value.schemaVersion !== 1) {
    throw new Error("Unsupported illuminated catalog schema.");
  }
  if (!Array.isArray(value.sets) || !value.sets.length) {
    throw new Error("Illuminated catalog contains no sets.");
  }
  const setIds = new Set();
  for (const set of value.sets) {
    if (
      typeof set?.id !== "string"
      || !set.id.startsWith("illuminatedletters:")
      || set.status !== "complete"
      || set.glyphCount !== GLYPHS.length
      || set.characterSet !== GLYPHS
      || setIds.has(set.id)
    ) {
      throw new Error("Invalid illuminated set metadata.");
    }
    setIds.add(set.id);
    if (set.access?.originalPathsPublished || set.access?.archivePathsPublished) {
      throw new Error(`${set.id} violates the preview-only catalog policy.`);
    }
    for (const derivative of [set.derivatives?.sample, set.derivatives?.cardPreview]) {
      if (!derivative || !isSafePreviewUrl(derivative.url)) {
        throw new Error(`${set.id} exposes an unsafe derivative URL.`);
      }
      assertHash(derivative.sha256, `${set.id} derivative`);
      if (!Number.isInteger(derivative.bytes) || derivative.bytes <= 0 || derivative.bytes > MAX_PREVIEW_BYTES) {
        throw new Error(`${set.id} derivative has an invalid byte length.`);
      }
    }
    if (!Array.isArray(set.glyphs) || set.glyphs.length !== GLYPHS.length) {
      throw new Error(`${set.id} has an incomplete glyph list.`);
    }
    for (const [index, glyph] of set.glyphs.entries()) {
      if (
        glyph?.character !== GLYPHS[index]
        || glyph.id !== GLYPHS[index]
        || glyph.ordinal !== index
        || glyph.derivative?.kind !== "watermarked-contact-sheet-fragment"
        || glyph.derivative?.url !== set.derivatives.cardPreview.url
        || !String(glyph.derivative.fragment || "").startsWith("glyph=")
      ) {
        throw new Error(`${set.id} contains an invalid glyph preview.`);
      }
      assertHash(glyph.sourceSha256, `${set.id}/${glyph.character}`);
    }
  }
  return value;
}

async function readLimited(response, limit, label) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw new Error(`${label} exceeds its byte limit.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > limit) throw new Error(`${label} exceeds its byte limit.`);
  return bytes;
}

function previewFileName(set) {
  const parsed = new URL(set.derivatives.cardPreview.url);
  const extension = path.extname(parsed.pathname) || ".png";
  return `${set.slug}-${set.derivatives.cardPreview.sha256.slice(0, 16)}${extension}`;
}

async function fetchPreview(fetchImpl, set, destination, previousDestination) {
  const existing = await readFile(previousDestination).catch(() => null);
  if (existing && sha256(existing) === set.derivatives.cardPreview.sha256) {
    await copyFile(previousDestination, destination);
    return false;
  }
  const response = await fetchImpl(set.derivatives.cardPreview.url, { redirect: "error" });
  if (!response.ok) throw new Error(`Unable to fetch preview for ${set.id}: ${response.status}`);
  const bytes = await readLimited(response, MAX_PREVIEW_BYTES, `${set.id} preview`);
  if (sha256(bytes) !== set.derivatives.cardPreview.sha256) {
    throw new Error(`Checksum mismatch for ${set.id} preview.`);
  }
  const temp = `${destination}.${process.pid}.tmp`;
  await writeFile(temp, bytes, { mode: 0o640 });
  await rename(temp, destination);
  return true;
}

export async function syncIlluminatedCatalog({
  catalogUrl = DEFAULT_CATALOG_URL,
  cacheDir = defaultCacheDir,
  fetchImpl = fetch,
  downloadPreviews = true,
} = {}) {
  if (!isSafeCatalogUrl(catalogUrl)) throw new Error("Catalog URL must be the canonical Illuminated Letters manifest.");
  const response = await fetchImpl(catalogUrl, { redirect: "error" });
  if (!response.ok) throw new Error(`Unable to fetch illuminated catalog: ${response.status}`);
  const rawCatalog = await readLimited(response, MAX_MANIFEST_BYTES, "Illuminated catalog");
  const catalog = validateCatalog(JSON.parse(rawCatalog.toString("utf8")));
  await mkdir(cacheDir, { recursive: true, mode: 0o750 });
  // Use a unique staging directory so an interrupted sync never replaces a
  // valid cache.
  const staging = path.join(cacheDir, `.staging-${process.pid}-${Date.now()}`);
  await mkdir(staging, { recursive: true, mode: 0o750 });
  let downloaded = 0;
  try {
    const previewDirectory = path.join(staging, "previews");
    if (downloadPreviews) {
      await mkdir(previewDirectory, { recursive: true, mode: 0o750 });
      for (const set of catalog.sets) {
        const destination = path.join(previewDirectory, previewFileName(set));
        const previousDestination = path.join(cacheDir, "current", "previews", previewFileName(set));
        if (await fetchPreview(fetchImpl, set, destination, previousDestination)) downloaded += 1;
      }
    }
    const cacheIndex = {
      schemaVersion: 1,
      catalogSha256: sha256(rawCatalog),
      cachedAt: new Date().toISOString(),
      catalogFile: "catalog.json",
      previews: Object.fromEntries(
        catalog.sets.map((set) => [set.id, downloadPreviews ? `previews/${previewFileName(set)}` : null]),
      ),
    };
    await writeFile(path.join(staging, "catalog.json"), rawCatalog, { mode: 0o640 });
    await writeFile(path.join(staging, "cache-index.json"), `${JSON.stringify(cacheIndex, null, 2)}\n`, { mode: 0o640 });
    const current = path.join(cacheDir, "current");
    const previous = path.join(cacheDir, ".previous");
    await rm(previous, { recursive: true, force: true });
    await rename(current, previous).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    await rename(staging, current);
    await rm(previous, { recursive: true, force: true });
    return { sets: catalog.sets.length, glyphs: catalog.sets.length * GLYPHS.length, downloaded, cacheDir: current };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

function isSafeCatalogUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === EXPECTED_ORIGIN && url.pathname === "/catalog/illuminated-letter-catalog.v1.json";
  } catch {
    return false;
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const metadataOnly = process.argv.includes("--metadata-only");
  const result = await syncIlluminatedCatalog({ downloadPreviews: !metadataOnly });
  console.info(`Illuminated catalog synced: ${result.sets} sets / ${result.glyphs} glyphs; ${result.downloaded} previews refreshed.`);
}
