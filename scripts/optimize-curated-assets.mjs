#!/usr/bin/env node

/**
 * Convert curated source art and first-party illuminated alphabets to compact,
 * high-quality WebP files, then finalize checksums/dimensions in public JSON.
 * Run after scripts/ingest-curated-books.py.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const storiesRoot = path.join(projectRoot, "public", "stories");
const privateCollectionsRoot = path.resolve(projectRoot, "..", "_private", "illuminatedletters", "collections");
const characters = "abcdefghijklmnopqrstuvwxyz0123456789".split("");

const storySlugs = ["alice-in-wonderland", "the-wonderful-wizard-of-oz"];

const illuminatedCollections = [
  {
    storySlug: "alice-in-wonderland",
    collectionDirectory: "fleur-de-lis-garden-gold",
    id: "fleur-de-lis-garden-gold-a-z-0-9",
    title: "Fleur-de-lis Garden Gold",
    sourcePage: "https://illuminatedletters.corydev.com/fleur-de-lis-garden-gold/illuminated-alphabet/",
    layoutDefaults: {
      renderHeightEm: 6.35,
      topLiftEm: -0.14,
      inlineEndGapEm: 0.33,
      blockEndGapEm: 0.12,
      baselineMode: "float-top",
      preserveTransparentCanvas: true,
      usePerGlyphAlphaBounds: true,
    },
  },
  {
    storySlug: "the-wonderful-wizard-of-oz",
    collectionDirectory: "seven-stone-reliquary-gold",
    id: "seven-stone-reliquary-gold-a-z-0-9",
    title: "Seven-Stone Reliquary Gold",
    sourcePage: "https://illuminatedletters.corydev.com/seven-stone-reliquary-gold/illuminated-alphabet/",
    layoutDefaults: {
      renderHeightEm: 6.25,
      topLiftEm: -0.13,
      inlineEndGapEm: 0.34,
      blockEndGapEm: 0.12,
      baselineMode: "float-top",
      preserveTransparentCanvas: true,
      usePerGlyphAlphaBounds: true,
    },
  },
];

async function sha256(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function alphaBounds(filePath) {
  const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
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
  if (right < left || bottom < top) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

async function finalizeStory(storySlug) {
  const storyPath = path.join(storiesRoot, storySlug, "story.json");
  const story = await readJson(storyPath);
  for (const asset of story.assets) {
    if (!asset.sourceFile) {
      throw new Error(`${storySlug}/${asset.id} is missing sourceFile; run the ingestion script first`);
    }
    const sourcePath = path.join(projectRoot, asset.sourceFile);
    const actualSourceHash = await sha256(sourcePath);
    if (actualSourceHash !== asset.sourceSha256) {
      throw new Error(`${storySlug}/${asset.id} source checksum changed`);
    }
    const outputPath = path.join(projectRoot, "public", asset.path.replace(/^\//, ""));
    await mkdir(path.dirname(outputPath), { recursive: true });

    let pipeline = sharp(sourcePath, { animated: false }).rotate().resize({
      width: 1600,
      height: 1600,
      fit: "inside",
      withoutEnlargement: true,
    });
    pipeline = storySlug === "alice-in-wonderland"
      ? pipeline.webp({ lossless: true, effort: 5 })
      : pipeline.webp({ quality: 88, alphaQuality: 100, effort: 5, smartSubsample: true });
    await pipeline.toFile(outputPath);

    const metadata = await sharp(outputPath).metadata();
    const bytes = (await readFile(outputPath)).byteLength;
    asset.sha256 = await sha256(outputPath);
    asset.bytes = bytes;
    asset.width = metadata.width;
    asset.height = metadata.height;
    asset.mime = "image/webp";
    delete asset.sourceFile;
  }
  story.build = {
    deterministic: true,
    assetEncoding: storySlug === "alice-in-wonderland" ? "lossless WebP" : "WebP quality 88",
    generatedBy: "scripts/ingest-curated-books.py + scripts/optimize-curated-assets.mjs",
  };
  await writeJson(storyPath, story);
  return {
    slug: storySlug,
    chapters: story.chapters.length,
    assets: story.assets.length,
    bytes: story.assets.reduce((total, asset) => total + asset.bytes, 0),
  };
}

async function buildIlluminatedCollection(config) {
  const sourceDirectory = path.join(
    privateCollectionsRoot,
    config.collectionDirectory,
    "originals",
  );
  const sourceManifestPath = path.join(
    privateCollectionsRoot,
    config.collectionDirectory,
    "manifest.json",
  );
  const outputDirectory = path.join(storiesRoot, config.storySlug, "illuminated");
  await mkdir(outputDirectory, { recursive: true });
  const sourceManifest = await readJson(sourceManifestPath);
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
      path: `/stories/${config.storySlug}/illuminated/${character}.webp`,
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

  const manifest = {
    schemaVersion: 1,
    id: config.id,
    title: config.title,
    format: "image/webp",
    colorMode: "RGBA",
    width: 512,
    height: 512,
    count: assets.length,
    characters: "A-Z + 0-9",
    source: {
      collectionId: sourceManifest.id,
      collectionTitle: sourceManifest.title,
      sourcePage: config.sourcePage,
      originalFormat: sourceManifest.format,
      originalWidth: sourceManifest.width,
      originalHeight: sourceManifest.height,
      transform: "512×512 WebP, quality 90, alpha quality 100, near-lossless",
    },
    layoutDefaults: config.layoutDefaults,
    assets,
  };
  await writeJson(path.join(outputDirectory, "manifest.json"), manifest);
  return { id: config.id, storySlug: config.storySlug, assets: assets.length };
}

const storyResults = [];
for (const storySlug of storySlugs) {
  storyResults.push(await finalizeStory(storySlug));
}

const illuminatedResults = [];
if (process.argv.includes("--legacy-full-alphabet")) {
  for (const config of illuminatedCollections) {
    illuminatedResults.push(await buildIlluminatedCollection(config));
  }
}

process.stdout.write(`${JSON.stringify({ stories: storyResults, illuminated: illuminatedResults }, null, 2)}\n`);
