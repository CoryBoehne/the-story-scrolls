import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_CATALOG_URL,
  syncIlluminatedCatalog,
  validateCatalog,
} from "../scripts/sync-illuminated-catalog.mjs";

const glyphs = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const previewBytes = Buffer.from("safe public preview derivative");
const previewUrl = "https://illuminatedletters.corydev.com/example/illuminated-alphabet/assets/sample.png";
const contactSheetUrl = "https://illuminatedletters.corydev.com/example/illuminated-alphabet/assets/previews/collection-contact-sheet-v1.webp";

function fixtureCatalog() {
  return {
    schemaVersion: 1,
    sets: [{
      id: "illuminatedletters:example",
      slug: "example",
      status: "complete",
      glyphCount: glyphs.length,
      characterSet: glyphs,
      access: { originalPathsPublished: false, archivePathsPublished: false },
      derivatives: {
        sample: { url: previewUrl, sha256: "a".repeat(64), bytes: 1 },
        cardPreview: { url: contactSheetUrl, sha256: sha256(previewBytes), bytes: previewBytes.length },
      },
      glyphs: glyphs.split("").map((character, ordinal) => ({
        id: character,
        character,
        ordinal,
        sourceSha256: "b".repeat(64),
        derivative: {
          kind: "watermarked-contact-sheet-fragment",
          fragment: `glyph=${character}`,
          url: contactSheetUrl,
        },
      })),
    }],
  };
}

test("sync imports only checksummed safe preview derivatives into private cache", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "storyscrolls-illuminated-catalog-"));
  const catalog = fixtureCatalog();
  const catalogBytes = Buffer.from(JSON.stringify(catalog));
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(String(url));
    if (url === DEFAULT_CATALOG_URL) return new Response(catalogBytes, { status: 200 });
    if (url === contactSheetUrl) return new Response(previewBytes, { status: 200 });
    return new Response(null, { status: 404 });
  };
  try {
    const first = await syncIlluminatedCatalog({ cacheDir, fetchImpl });
    assert.deepEqual(first, {
      sets: 1,
      glyphs: 36,
      downloaded: 1,
      cacheDir: path.join(cacheDir, "current"),
    });
    assert.deepEqual(requested, [DEFAULT_CATALOG_URL, contactSheetUrl]);
    assert.deepEqual(JSON.parse(await readFile(path.join(cacheDir, "current", "catalog.json"), "utf8")), catalog);
    const cacheIndex = JSON.parse(await readFile(path.join(cacheDir, "current", "cache-index.json"), "utf8"));
    const cachedPreview = await readFile(path.join(cacheDir, "current", cacheIndex.previews["illuminatedletters:example"]));
    assert.equal(sha256(cachedPreview), sha256(previewBytes));

    requested.length = 0;
    const second = await syncIlluminatedCatalog({ cacheDir, fetchImpl });
    assert.equal(second.downloaded, 0);
    assert.deepEqual(requested, [DEFAULT_CATALOG_URL]);
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("catalog validation rejects raw glyph, archive, or incomplete-glyph URLs", () => {
  const unsafe = fixtureCatalog();
  unsafe.sets[0].derivatives.sample.url =
    "https://illuminatedletters.corydev.com/example/illuminated-alphabet/assets/letters/a.png";
  assert.throws(() => validateCatalog(unsafe), /unsafe derivative URL/);

  const incomplete = fixtureCatalog();
  incomplete.sets[0].glyphs.pop();
  assert.throws(() => validateCatalog(incomplete), /incomplete glyph list/);
});
