import crypto from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import { validateCatalog } from "../scripts/sync-illuminated-catalog.mjs";

const DEFAULT_CATALOG_DIRECTORY = fileURLToPath(
  new URL("../../../_data/thestoryscrolls/illuminated-catalog/current/", import.meta.url),
);
const DEFAULT_PRIVATE_COLLECTIONS_ROOT = fileURLToPath(
  new URL("../../_private/illuminatedletters/collections/", import.meta.url),
);
const MAX_CATALOG_BYTES = 12 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_GLYPH_BYTES = 24 * 1024 * 1024;
const GLYPH_CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const SET_ID_PATTERN = /^illuminatedletters:[a-z0-9][a-z0-9-]{0,159}$/;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,159}$/;

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function readBounded(filePath, maxBytes, label) {
  const metadata = await stat(filePath);
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > maxBytes) {
    throw new Error(`${label} is missing or outside its byte limit.`);
  }
  return readFile(filePath);
}

async function containedRealPath(root, candidate, label) {
  const [resolvedRoot, resolvedCandidate] = await Promise.all([
    realpath(root),
    realpath(candidate),
  ]);
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`${label} escaped its private collection root.`);
  }
  return resolvedCandidate;
}

function manifestGlyphFiles(manifest) {
  const files = new Map();
  if (Array.isArray(manifest.assets)) {
    for (const asset of manifest.assets) {
      const character = asset?.letter ?? asset?.digit;
      if (typeof character === "string" && typeof asset?.file === "string") {
        files.set(character.toUpperCase(), asset.file);
      }
    }
  } else {
    for (const character of GLYPH_CHARACTERS) {
      files.set(character, `${character.toLowerCase()}.png`);
    }
  }
  return files;
}

function manifestOriginalDirectory(manifest) {
  if (manifest.originals && typeof manifest.originals === "object") {
    return manifest.originals.directory || "originals";
  }
  return manifest.originalDirectory || manifest.originals || "originals";
}

function usedOpeningCharacters(chapters) {
  const characters = new Set();
  for (const chapter of chapters || []) {
    const firstParagraph = Array.isArray(chapter?.blocks)
      ? chapter.blocks.find(
          (block) =>
            (block?.kind === "paragraph" || block?.type === "paragraph")
            && String(block.text || "").trim(),
        )
      : null;
    const character = String(chapter?.firstLetter || firstParagraph?.text || "")
      .trim()
      .slice(0, 1)
      .toUpperCase();
    if (GLYPH_CHARACTERS.includes(character)) characters.add(character);
  }
  return [...characters].sort((left, right) =>
    GLYPH_CHARACTERS.indexOf(left) - GLYPH_CHARACTERS.indexOf(right));
}

/**
 * Resolve a creator-selected set against the hash-pinned catalog and private
 * source tree. No original path is returned to a client.
 */
export async function resolveIlluminatedSet({
  setId,
  catalogDirectory = DEFAULT_CATALOG_DIRECTORY,
  privateCollectionsRoot = DEFAULT_PRIVATE_COLLECTIONS_ROOT,
} = {}) {
  if (!setId) return null;
  if (!SET_ID_PATTERN.test(setId)) throw new Error("Unknown illuminated-letter set.");
  const catalogBytes = await readBounded(
    path.join(catalogDirectory, "catalog.json"),
    MAX_CATALOG_BYTES,
    "Illuminated catalog",
  );
  const catalog = validateCatalog(JSON.parse(catalogBytes.toString("utf8")));
  const set = catalog.sets.find((candidate) => candidate.id === setId);
  if (!set || !SLUG_PATTERN.test(set.slug)) throw new Error("Unknown illuminated-letter set.");

  const collectionDirectory = await containedRealPath(
    privateCollectionsRoot,
    path.join(privateCollectionsRoot, set.slug),
    "Illuminated collection",
  );
  const manifestPath = await containedRealPath(
    privateCollectionsRoot,
    path.join(collectionDirectory, "manifest.json"),
    "Illuminated manifest",
  );
  const manifestBytes = await readBounded(manifestPath, MAX_MANIFEST_BYTES, "Illuminated manifest");
  if (sha256(manifestBytes) !== set.source.sourceManifestSha256) {
    throw new Error("The illuminated-letter source changed after the catalog was synced.");
  }
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.slug && manifest.slug !== set.slug) {
    throw new Error("The illuminated-letter source does not match its catalog entry.");
  }
  const originalDirectory = await containedRealPath(
    privateCollectionsRoot,
    path.join(collectionDirectory, manifestOriginalDirectory(manifest)),
    "Illuminated originals directory",
  );
  const files = manifestGlyphFiles(manifest);
  if (files.size !== GLYPH_CHARACTERS.length) {
    throw new Error("The illuminated-letter source is incomplete.");
  }
  const sourceHashes = new Map(set.glyphs.map((glyph) => [glyph.character, glyph.sourceSha256]));
  return Object.freeze({
    id: set.id,
    slug: set.slug,
    displayName: set.displayName,
    family: set.family,
    version: set.version,
    attribution: set.source?.attribution || "Illuminated Letters",
    termsUrl: set.licensing?.termsUrl || set.source?.catalogUrl || null,
    glyphsSha256: set.glyphsSha256,
    catalogSha256: sha256(catalogBytes),
    collectionDirectory,
    originalDirectory,
    files,
    sourceHashes,
  });
}

/**
 * Create only the initials the completed story actually uses. Filenames are
 * bound to the story UUID and source hash, so they neither reveal the letter
 * nor provide an enumerable alphabet path.
 */
export async function materializeStoryInitials({ storyId, chapters, resolvedSet }) {
  if (!resolvedSet) return { assets: [], glyphs: {} };
  const assets = [];
  const glyphs = {};
  for (const character of usedOpeningCharacters(chapters)) {
    const sourceFile = resolvedSet.files.get(character);
    const sourceHash = resolvedSet.sourceHashes.get(character);
    if (!sourceFile || !/^[a-z0-9][a-z0-9._-]*\.png$/i.test(sourceFile) || !sourceHash) {
      throw new Error(`The illuminated-letter source is missing ${character}.`);
    }
    const sourcePath = await containedRealPath(
      resolvedSet.originalDirectory,
      path.join(resolvedSet.originalDirectory, sourceFile),
      "Illuminated glyph",
    );
    const sourceBytes = await readBounded(sourcePath, MAX_GLYPH_BYTES, "Illuminated glyph");
    if (sha256(sourceBytes) !== sourceHash) {
      throw new Error(`The illuminated-letter glyph ${character} failed its integrity check.`);
    }
    const delivered = await sharp(sourceBytes, { animated: false, failOn: "error" })
      .resize({ width: 384, height: 384, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 84, alphaQuality: 100, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    const filename = `${sha256(`${storyId}\0${resolvedSet.id}\0${character}\0${sourceHash}`).slice(0, 40)}.webp`;
    const id = crypto.randomUUID();
    assets.push({
      id,
      // The existing strict asset schema predates protected initials. These
      // rows use its legacy generated-image lane and are excluded from the
      // public illustration list by their dedicated model marker.
      role: "illustration",
      origin: "generated",
      placementKind: "legacy",
      filename,
      originalFilename: null,
      bytes: delivered.data,
      width: delivered.info.width,
      height: delivered.info.height,
      altText: "",
      creatorCredit: "Illuminated Letters",
      model: "illuminated-letters-initial-v1",
      initialCharacter: character.toLowerCase(),
    });
    glyphs[character.toLowerCase()] = filename;
  }
  return { assets, glyphs };
}

export const illuminatedGlyphDefaults = Object.freeze({
  catalogDirectory: DEFAULT_CATALOG_DIRECTORY,
  privateCollectionsRoot: DEFAULT_PRIVATE_COLLECTIONS_ROOT,
});
