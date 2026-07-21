#!/usr/bin/env node

import crypto from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  materializeStoryInitials,
  resolveIlluminatedSet,
} from "../server/illuminated-glyphs.mjs";

const projectRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const publicRoot = path.join(projectRoot, "public");
const storiesRoot = path.join(publicRoot, "stories");
const outputRoot = path.join(publicRoot, "assets", "story-initials");
const stagingRoot = path.join(
  publicRoot,
  "assets",
  `.story-initials-${process.pid}-${crypto.randomBytes(4).toString("hex")}`,
);
const legacyStaticRoot = path.join(publicRoot, "assets", "curated-illuminated");
const legacyDistRoot = path.join(
  projectRoot,
  "dist",
  "client",
  "assets",
  "curated-illuminated",
);
const SET_ID_PATTERN = /^illuminatedletters:[a-z0-9][a-z0-9-]{0,159}$/;
const LEGACY_STORY_SETS = new Map([
  ["alice-in-wonderland", "fleur-de-lis-garden-gold"],
  ["the-wonderful-wizard-of-oz", "seven-stone-reliquary-gold"],
]);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function deriveSetId(story) {
  const configuredId = story?.theme?.illuminatedSetId;
  if (typeof configuredId === "string" && SET_ID_PATTERN.test(configuredId)) {
    return configuredId;
  }
  const legacyPath = story?.theme?.illuminatedSet;
  const legacyMatch = typeof legacyPath === "string"
    ? legacyPath.match(/^\/assets\/curated-illuminated\/([a-z0-9][a-z0-9-]{0,159})$/)
    : null;
  const slug = legacyMatch?.[1]
    || LEGACY_STORY_SETS.get(story.slug)
    || (typeof story?.theme?.id === "string" && /^[a-z0-9][a-z0-9-]{0,159}$/.test(story.theme.id)
      ? story.theme.id
      : null);
  if (!slug) throw new Error(`${story.slug}: no illuminated-letter set is configured.`);
  return `illuminatedletters:${slug}`;
}

async function readStories() {
  const entries = await readdir(storiesRoot, { withFileTypes: true });
  const stories = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) continue;
    const filePath = path.join(storiesRoot, entry.name, "story.json");
    let source;
    try {
      source = await readFile(filePath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    const story = JSON.parse(source);
    if (!story || story.slug !== entry.name || !Array.isArray(story.chapters)) {
      throw new Error(`${filePath}: invalid curated story document.`);
    }
    stories.push({ filePath, story });
  }
  return stories;
}

async function removeLegacyPublishedAlphabets(stories) {
  await rm(legacyStaticRoot, { recursive: true, force: true });
  await rm(legacyDistRoot, { recursive: true, force: true });
  for (const { story } of stories) {
    await rm(path.join(storiesRoot, story.slug, "illuminated"), {
      recursive: true,
      force: true,
    });
    await rm(path.join(projectRoot, "dist", "client", "stories", story.slug, "illuminated"), {
      recursive: true,
      force: true,
    });
  }
}

const stories = await readStories();
const resolvedSets = new Map();
const updates = [];
await mkdir(stagingRoot, { recursive: true, mode: 0o750 });

try {
  for (const { filePath, story } of stories) {
    const setId = deriveSetId(story);
    let resolvedSet = resolvedSets.get(setId);
    if (!resolvedSet) {
      resolvedSet = await resolveIlluminatedSet({ setId });
      resolvedSets.set(setId, resolvedSet);
    }
    const storyDirectory = sha256(`curated-story-initials\0${story.slug}`).slice(0, 32);
    const targetDirectory = path.join(stagingRoot, storyDirectory);
    const materialized = await materializeStoryInitials({
      storyId: `curated:${story.slug}`,
      chapters: story.chapters,
      resolvedSet,
    });
    await mkdir(targetDirectory, { recursive: true, mode: 0o750 });
    const illuminatedGlyphs = {};
    for (const asset of materialized.assets) {
      await writeFile(path.join(targetDirectory, asset.filename), asset.bytes, {
        mode: 0o640,
        flag: "wx",
      });
      illuminatedGlyphs[asset.initialCharacter] =
        `/assets/story-initials/${storyDirectory}/${asset.filename}`;
    }
    const nextTheme = {
      ...(story.theme || {}),
      illuminatedGlyphs,
      illuminatedSetId: resolvedSet.id,
      illuminatedSetName: resolvedSet.displayName,
      illuminatedSetVersion: resolvedSet.version,
      illuminatedCatalogVersion: resolvedSet.catalogSha256,
      illuminatedGlyphsSha256: resolvedSet.glyphsSha256,
      illuminatedAttribution: resolvedSet.attribution,
      illuminatedTermsUrl: resolvedSet.termsUrl,
      illuminatedDerivativePolicy: "used-initials-only-384px-opaque-paths",
    };
    delete nextTheme.illuminatedSet;
    delete nextTheme.illuminatedManifest;
    story.theme = nextTheme;
    updates.push({ filePath, story, glyphCount: materialized.assets.length });
  }

  await rm(outputRoot, { recursive: true, force: true });
  await rename(stagingRoot, outputRoot);
  for (const { filePath, story } of updates) {
    await writeFile(filePath, `${JSON.stringify(story, null, 2)}\n`, { mode: 0o640 });
  }
  await removeLegacyPublishedAlphabets(stories);
} catch (error) {
  await rm(stagingRoot, { recursive: true, force: true });
  throw error;
}

process.stdout.write(`${JSON.stringify({
  stories: updates.length,
  sets: resolvedSets.size,
  derivatives: updates.reduce((total, item) => total + item.glyphCount, 0),
  policy: "used-initials-only-384px-opaque-paths",
}, null, 2)}\n`);
