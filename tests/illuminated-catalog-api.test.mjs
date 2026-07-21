import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createIlluminatedCatalogHandler,
  loadIlluminatedCatalog,
  publicIlluminatedCatalog,
  readIlluminatedPreview,
} from "../server/illuminated-catalog.mjs";
import { createPlatformServer } from "../server/platform-server.mjs";

const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const preview = Buffer.from("controlled watermarked preview derivative");
const hash = (value) => createHash("sha256").update(value).digest("hex");

function sourceCatalog() {
  const previewHash = hash(preview);
  const contactSheet =
    "https://illuminatedletters.corydev.com/forest-study/illuminated-alphabet/assets/previews/sample-card-v1.webp";
  return {
    schemaVersion: 1,
    sets: [{
      id: "illuminatedletters:forest-study",
      slug: "forest-study",
      displayName: "Forest Study",
      family: "Woodland",
      description: "Leaves, moss, and hand-worked gold.",
      status: "complete",
      version: 1,
      sortOrder: 10,
      glyphCount: 36,
      characterSet: characters,
      sampleCharacter: "F",
      source: {
        attribution: "Illuminated Letters",
        catalogUrl: "https://illuminatedletters.corydev.com/forest-study/",
        sourceManifestSha256: "1".repeat(64),
      },
      licensing: {
        status: "terms-not-published-in-catalog",
        attributionRequired: true,
        termsUrl: "https://illuminatedletters.corydev.com/forest-study/",
        note: "Preview derivatives are catalog material only. Production use requires a separate rights record.",
      },
      access: {
        availability: "preview-derivatives-only",
        archivePathsPublished: false,
        originalPathsPublished: false,
      },
      derivatives: {
        sample: {
          url: "https://illuminatedletters.corydev.com/forest-study/illuminated-alphabet/assets/sample.png",
          sha256: "2".repeat(64),
          bytes: 2048,
        },
        cardPreview: { url: contactSheet, sha256: previewHash, bytes: preview.length },
      },
      glyphsSha256: "3".repeat(64),
      glyphs: [...characters].map((character, ordinal) => ({
        id: character,
        character,
        ordinal,
        sourceSha256: "4".repeat(64),
        derivative: {
          kind: "watermarked-contact-sheet-fragment",
          fragment: `glyph=${character}`,
          url: contactSheet,
        },
      })),
    }],
  };
}

async function fixtureCache() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "storyscrolls-font-api-"));
  await mkdir(path.join(directory, "previews"));
  const catalogBytes = Buffer.from(JSON.stringify(sourceCatalog()));
  const relativePath = `previews/forest-study-${hash(preview).slice(0, 16)}.webp`;
  await Promise.all([
    writeFile(path.join(directory, "catalog.json"), catalogBytes),
    writeFile(path.join(directory, relativePath), preview),
    writeFile(path.join(directory, "cache-index.json"), JSON.stringify({
      schemaVersion: 1,
      catalogSha256: hash(catalogBytes),
      cachedAt: "2026-07-21T20:00:00.000Z",
      catalogFile: "catalog.json",
      previews: { "illuminatedletters:forest-study": relativePath },
    })),
  ]);
  return directory;
}

function responseRecorder() {
  return {
    status: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body = Buffer.alloc(0)) {
      this.body = Buffer.from(body);
    },
  };
}

test("public catalog exposes 233-safe shape without originals, glyph records, paths, or hashes", async () => {
  const directory = await fixtureCache();
  try {
    const loaded = await loadIlluminatedCatalog(directory);
    const result = publicIlluminatedCatalog(loaded);
    assert.equal(result.count, 1);
    assert.equal(result.glyphCount, 36);
    assert.equal(result.previewPolicy.originalsPublished, false);
    assert.equal(result.previewPolicy.browserCopyProtection, false);
    assert.match(result.previewPolicy.notice, /cannot be made uncopyable/i);
    assert.match(result.previewPolicy.licensing, /terms are not published/i);
    assert.equal(result.sets[0].previewUrl, "/api/v2/illuminated-sets/forest-study/preview");
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      "sourceManifestSha256",
      "glyphsSha256",
      "sourceSha256",
      '"derivatives":',
      "relativePath",
      "sample-card-v1.webp",
      "/letters/",
      ".zip",
    ]) {
      assert.ok(!serialized.includes(forbidden), `public catalog leaked ${forbidden}`);
    }
    const resultPreview = await readIlluminatedPreview(loaded, "forest-study");
    assert.deepEqual(resultPreview.bytes, preview);
    assert.equal(resultPreview.contentType, "image/webp");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("catalog and preview endpoints both require the caller's authenticated session decision", async () => {
  const directory = await fixtureCache();
  try {
    const denied = createIlluminatedCatalogHandler({ cacheDirectory: directory, isAuthenticated: () => false });
    const deniedResponse = responseRecorder();
    assert.equal(await denied(
      { method: "GET", url: "/api/v2/illuminated-sets" },
      deniedResponse,
      new URL("http://localhost/api/v2/illuminated-sets"),
    ), true);
    assert.equal(deniedResponse.status, 401);

    const allowed = createIlluminatedCatalogHandler({ cacheDirectory: directory, isAuthenticated: () => true });
    const listResponse = responseRecorder();
    await allowed(
      { method: "GET", url: "/api/v2/illuminated-sets" },
      listResponse,
      new URL("http://localhost/api/v2/illuminated-sets"),
    );
    assert.equal(listResponse.status, 200);
    assert.equal(JSON.parse(listResponse.body).sets.length, 1);
    assert.equal(listResponse.headers["Cache-Control"], "no-store");

    const previewResponse = responseRecorder();
    await allowed(
      { method: "GET", url: "/api/v2/illuminated-sets/forest-study/preview" },
      previewResponse,
      new URL("http://localhost/api/v2/illuminated-sets/forest-study/preview"),
    );
    assert.equal(previewResponse.status, 200);
    assert.equal(previewResponse.headers["Cross-Origin-Resource-Policy"], "same-origin");
    assert.deepEqual(previewResponse.body, preview);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("catalog and preview routes are available only when the caller explicitly stages authentication off", async () => {
  const directory = await fixtureCache();
  try {
    const stagedOpen = createIlluminatedCatalogHandler({
      cacheDirectory: directory,
      authenticationRequired: false,
      isAuthenticated: () => false,
    });
    const catalogResponse = responseRecorder();
    await stagedOpen(
      { method: "GET", url: "/api/v2/illuminated-sets" },
      catalogResponse,
      new URL("http://localhost/api/v2/illuminated-sets"),
    );
    assert.equal(catalogResponse.status, 200);

    const previewResponse = responseRecorder();
    await stagedOpen(
      { method: "GET", url: "/api/v2/illuminated-sets/forest-study/preview" },
      previewResponse,
      new URL("http://localhost/api/v2/illuminated-sets/forest-study/preview"),
    );
    assert.equal(previewResponse.status, 200);
    assert.deepEqual(previewResponse.body, preview);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("platform launch toggle opens the catalog before auth launch and protects it after", async () => {
  const directory = await fixtureCache();
  const openData = await mkdtemp(path.join(os.tmpdir(), "storyscrolls-font-open-"));
  const protectedData = await mkdtemp(path.join(os.tmpdir(), "storyscrolls-font-protected-"));
  const options = {
    illuminatedCatalogDirectory: directory,
    fetchImpl: async () => { throw new Error("unexpected upstream request"); },
    fingerprintSecret: "test-only-illuminated-catalog-secret",
    logger: { info() {}, error() {} },
  };
  const openPlatform = createPlatformServer({ ...options, dataDir: openData, requireAuthentication: false });
  const protectedPlatform = createPlatformServer({
    ...options,
    dataDir: protectedData,
    requireAuthentication: true,
    authConfiguration: {
      publicOrigin: "https://thestoryscrolls.com",
      sessionSecret: "test-session-secret-that-is-longer-than-thirty-two-characters",
    },
  });
  try {
    const openAddress = await openPlatform.listen(0);
    const openResponse = await fetch(`http://127.0.0.1:${openAddress.port}/api/v2/illuminated-sets`);
    assert.equal(openResponse.status, 200);
    assert.equal((await openResponse.json()).sets.length, 1);

    const protectedAddress = await protectedPlatform.listen(0);
    const protectedResponse = await fetch(`http://127.0.0.1:${protectedAddress.port}/api/v2/illuminated-sets`);
    assert.equal(protectedResponse.status, 401);
    assert.equal((await protectedResponse.json()).error, "authentication_required");
  } finally {
    await Promise.all([openPlatform.close(), protectedPlatform.close()]);
    await Promise.all([
      rm(directory, { recursive: true, force: true }),
      rm(openData, { recursive: true, force: true }),
      rm(protectedData, { recursive: true, force: true }),
    ]);
  }
});

test("handler refuses to mount without an explicit authentication boundary", () => {
  assert.throws(() => createIlluminatedCatalogHandler(), /authentication callback/);
});

test("handler rejects ambiguous authentication configuration", () => {
  assert.throws(
    () => createIlluminatedCatalogHandler({ authenticationRequired: "false", isAuthenticated: () => false }),
    /authenticationRequired must be a boolean/,
  );
});

test("the platform wires the catalog to the same staged authentication gate as Create Studio", async () => {
  const source = await readFile(new URL("../server/platform-server.mjs", import.meta.url), "utf8");
  assert.match(
    source,
    /createIlluminatedCatalogHandler\(\{[\s\S]{0,240}authenticationRequired: requireAuthentication,[\s\S]{0,240}isAuthenticated:/,
  );
});
