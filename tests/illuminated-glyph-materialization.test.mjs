import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";

import {
  illuminatedGlyphDefaults,
  materializeStoryInitials,
  resolveIlluminatedSet,
} from "../server/illuminated-glyphs.mjs";

const TEST_SET_ID = "illuminatedletters:fleur-de-lis-garden-gold";

test("selected sets materialize only used initials as opaque, bounded transparent derivatives", async () => {
  const resolvedSet = await resolveIlluminatedSet({ setId: TEST_SET_ID });
  const result = await materializeStoryInitials({
    storyId: "f43a560c-cf20-4c57-88ed-19be90696cb6",
    chapters: [
      { firstLetter: "A", blocks: [{ type: "paragraph", text: "Another road." }] },
      { blocks: [{ kind: "paragraph", text: "Beneath the moon." }] },
      { blocks: [{ kind: "paragraph", text: "Another turning." }] },
      { blocks: [{ kind: "paragraph", text: "—Beyond punctuation." }] },
    ],
    resolvedSet,
  });

  assert.deepEqual(Object.keys(result.glyphs), ["a", "b"]);
  assert.equal(result.assets.length, 2);
  for (const asset of result.assets) {
    assert.match(asset.filename, /^[a-f0-9]{40}\.webp$/);
    assert.doesNotMatch(asset.filename, new RegExp(`^${asset.initialCharacter}\\.`, "i"));
    assert.equal(asset.model, "illuminated-letters-initial-v1");
    const metadata = await sharp(asset.bytes).metadata();
    assert.equal(metadata.format, "webp");
    assert.ok((metadata.width ?? 0) <= 384);
    assert.ok((metadata.height ?? 0) <= 384);
    assert.equal(metadata.hasAlpha, true);
  }
});

test("resolver rejects unknown IDs and catalog/source drift before rendering", async () => {
  await assert.rejects(
    resolveIlluminatedSet({ setId: "illuminatedletters:no-such-set" }),
    /Unknown illuminated-letter set/,
  );

  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "storyscrolls-glyph-drift-"));
  const catalogDirectory = path.join(temporaryRoot, "catalog");
  const privateRoot = path.join(temporaryRoot, "private");
  const setSlug = TEST_SET_ID.slice("illuminatedletters:".length);
  const sourceManifest = path.join(
    illuminatedGlyphDefaults.privateCollectionsRoot,
    setSlug,
    "manifest.json",
  );
  try {
    await mkdir(catalogDirectory, { recursive: true });
    await mkdir(path.join(privateRoot, setSlug, "originals"), { recursive: true });
    await writeFile(
      path.join(catalogDirectory, "catalog.json"),
      await readFile(path.join(illuminatedGlyphDefaults.catalogDirectory, "catalog.json")),
    );
    await writeFile(
      path.join(privateRoot, setSlug, "manifest.json"),
      Buffer.concat([await readFile(sourceManifest), Buffer.from("\n")]),
    );
    await assert.rejects(
      resolveIlluminatedSet({
        setId: TEST_SET_ID,
        catalogDirectory,
        privateCollectionsRoot: privateRoot,
      }),
      /source changed after the catalog was synced/,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
