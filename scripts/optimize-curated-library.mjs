#!/usr/bin/env node

/** Finalize registry-built story art and shared illuminated alphabets. */

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const registryPath = path.join(projectRoot, "config", "curated-books.json");
const storiesRoot = path.join(projectRoot, "public", "stories");
const publicIlluminatedRoot = path.join(projectRoot, "public", "assets", "curated-illuminated");
const privateCollectionsRoot = path.resolve(
  projectRoot,
  "..",
  "_private",
  "illuminatedletters",
  "collections",
);
const characters = "abcdefghijklmnopqrstuvwxyz0123456789".split("");

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function sha256(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function alphaBounds(filePath) {
  const { data, info } = await sharp(filePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  const alphaChannel = info.channels - 1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const alpha = data[(y * info.width + x) * info.channels + alphaChannel];
      if (alpha <= 3) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return right < left || bottom < top
    ? { x: 0, y: 0, width: 0, height: 0 }
    : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

async function applyTransparentPadding(filePath, requestedPadding) {
  const { data, info } = await sharp(filePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const padding = Object.fromEntries(
    ["top", "right", "bottom", "left"].map((edge) => [
      edge,
      Math.max(0, Math.floor(Number(requestedPadding?.[edge]) || 0)),
    ]),
  );
  if (padding.left + padding.right >= info.width || padding.top + padding.bottom >= info.height) {
    throw new Error(`${filePath}: transparent padding consumes the entire image`);
  }

  const alphaChannel = info.channels - 1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (
        x < padding.left ||
        x >= info.width - padding.right ||
        y < padding.top ||
        y >= info.height - padding.bottom
      ) {
        data[(y * info.width + x) * info.channels + alphaChannel] = 0;
      }
    }
  }

  const encoded = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  })
    .webp({ lossless: true, effort: 5 })
    .toBuffer();
  await writeFile(filePath, encoded);
  return padding;
}

async function finalizeStory(config) {
  const storyPath = path.join(storiesRoot, config.slug, "story.json");
  const story = await readJson(storyPath);
  const assetTransforms = new Map(
    (config.assetTransforms ?? []).map((transform) => [transform.sourceUrl, transform]),
  );
  let totalBytes = 0;

  for (const asset of story.assets) {
    let outputPath = path.join(projectRoot, "public", asset.path.replace(/^\//, ""));
    await mkdir(path.dirname(outputPath), { recursive: true });
    if (asset.sourceFile) {
      const sourcePath = path.join(projectRoot, asset.sourceFile);
      const sourceHash = await sha256(sourcePath);
      if (sourceHash !== asset.sourceSha256) {
        throw new Error(`${config.slug}/${asset.id}: source checksum changed`);
      }
      await sharp(sourcePath, { animated: false })
        .rotate()
        .resize({
          width: 1500,
          height: 1500,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 88, alphaQuality: 100, effort: 5, smartSubsample: true })
        .toFile(outputPath);
      delete asset.sourceFile;
    }
    const transform = assetTransforms.get(asset.sourceUrl);
    if (transform?.transparentPadding) {
      asset.transparentPadding = await applyTransparentPadding(
        outputPath,
        transform.transparentPadding,
      );
    }
    if (transform?.contentAddressed) {
      const contentHash = await sha256(outputPath);
      const extension = path.extname(outputPath);
      const basename = path.basename(outputPath, extension).replace(/-[a-f0-9]{12}$/i, "");
      const versionedPath = path.join(
        path.dirname(outputPath),
        `${basename}-${contentHash.slice(0, 12)}${extension}`,
      );
      if (versionedPath !== outputPath) await copyFile(outputPath, versionedPath);
      outputPath = versionedPath;
      asset.path = `/${path.relative(path.join(projectRoot, "public"), outputPath)}`;
    }
    const metadata = await sharp(outputPath).metadata();
    const bytes = (await readFile(outputPath)).byteLength;
    asset.sha256 = await sha256(outputPath);
    asset.bytes = bytes;
    asset.width = metadata.width;
    asset.height = metadata.height;
    asset.mime = "image/webp";
    totalBytes += bytes;
  }

  story.build = {
    deterministic: true,
    assetEncoding: "WebP quality 88, maximum 1500×1500",
    generatedBy:
      "scripts/ingest-curated-library.py + scripts/optimize-curated-library.mjs",
  };
  await writeJson(storyPath, story);
  return {
    slug: config.slug,
    chapters: story.chapters.length,
    assets: story.assets.length,
    bytes: totalBytes,
  };
}

async function buildIlluminatedCollection(collectionSlug) {
  const sourceDirectory = path.join(privateCollectionsRoot, collectionSlug, "originals");
  const sourceManifestPath = path.join(privateCollectionsRoot, collectionSlug, "manifest.json");
  const outputDirectory = path.join(publicIlluminatedRoot, collectionSlug);
  const sourceManifest = await readJson(sourceManifestPath);
  await mkdir(outputDirectory, { recursive: true });
  const assets = [];

  for (const character of characters) {
    const sourcePath = path.join(sourceDirectory, `${character}.png`);
    const outputPath = path.join(outputDirectory, `${character}.webp`);
    await sharp(sourcePath)
      .resize(512, 512, { fit: "fill" })
      .webp({ quality: 90, alphaQuality: 100, nearLossless: true, effort: 5 })
      .toFile(outputPath);
    const bounds = await alphaBounds(outputPath);
    assets.push({
      character: character.toUpperCase(),
      file: `${character}.webp`,
      path: `/assets/curated-illuminated/${collectionSlug}/${character}.webp`,
      sha256: await sha256(outputPath),
      sourceSha256: await sha256(sourcePath),
      alphaBounds: bounds,
      transparentPadding: {
        top: bounds.y,
        right: 512 - bounds.x - bounds.width,
        bottom: 512 - bounds.y - bounds.height,
        left: bounds.x,
      },
    });
  }

  const title =
    sourceManifest.title ??
    sourceManifest.name ??
    sourceManifest.workId ??
    collectionSlug.replaceAll("-", " ");
  const manifest = {
    schemaVersion: 1,
    id: sourceManifest.id ?? sourceManifest.workId ?? collectionSlug,
    title,
    format: "image/webp",
    colorMode: "RGBA",
    width: 512,
    height: 512,
    count: assets.length,
    characters: "A-Z + 0-9",
    source: {
      collectionId: sourceManifest.id ?? sourceManifest.workId ?? collectionSlug,
      collectionTitle: title,
      sourcePage: `https://illuminatedletters.corydev.com/${collectionSlug}/illuminated-alphabet/`,
      transform: "512×512 WebP, quality 90, alpha quality 100, near-lossless",
    },
    layoutDefaults: {
      renderHeightEm: 6.3,
      topLiftEm: -0.18,
      inlineEndGapEm: 0.34,
      blockEndGapEm: 0.12,
      baselineMode: "float-top",
      preserveTransparentCanvas: true,
      usePerGlyphAlphaBounds: true,
    },
    assets,
  };
  await writeJson(path.join(outputDirectory, "manifest.json"), manifest);
  return { slug: collectionSlug, assets: assets.length };
}

const requested = new Set(
  process.argv
    .filter((argument) => argument.startsWith("--slug="))
    .map((argument) => argument.slice("--slug=".length)),
);
const registry = await readJson(registryPath);
const selected = requested.size
  ? registry.filter((config) => requested.has(config.slug))
  : registry;
const missing = [...requested].filter((slug) => !selected.some((config) => config.slug === slug));
if (missing.length) throw new Error(`Unknown curated slug(s): ${missing.join(", ")}`);

const storyResults = [];
for (const config of selected) storyResults.push(await finalizeStory(config));

const collectionResults = [];
if (process.argv.includes("--legacy-full-alphabet")) {
  for (const collection of new Set(selected.map((config) => config.illuminatedSet))) {
    collectionResults.push(await buildIlluminatedCollection(collection));
  }
}

process.stdout.write(
  `${JSON.stringify({ stories: storyResults, illuminated: collectionResults }, null, 2)}\n`,
);
