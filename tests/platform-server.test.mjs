import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import Database from "better-sqlite3";
import sharp from "sharp";

import { createPlatformServer } from "../server/platform-server.mjs";

const ORIGIN = "https://thestoryscrolls.com";
const TEST_KEY = "sk-test-this-key-must-never-be-persisted-123456789";

function mockStory(
  targetChapters = 1,
  heroCount = 0,
  inlinePerChapter = 0,
  illustrationRequest = {},
) {
  const chapters = Array.from({ length: targetChapters }, (_, index) => ({
    title: `The Unmapped Turning ${index + 1}`,
    blocks: [
      {
        kind: "paragraph",
        text:
          index === 0
            ? "[Publisher announcement]\nThe lantern leaned into the wind while the [silver rune] remained in the mapmaker's hand."
            : `The lantern crossed another unmapped threshold in chapter ${index + 1}.`,
      },
      { kind: "verse", text: "Road under moon,\nInk under thumb." },
    ],
  }));
  return {
    title: "The Lantern Road",
    author_name: "Model should not override the credited author",
    synopsis: "A mapmaker follows a stubborn lantern beyond the edge of every known road.",
    content_warnings: ["Mild fantasy peril"],
    chapters,
    ...(heroCount
      ? {
          visual_bible:
            "Loose umber ink, mineral blue watercolor, amber practical light, fibrous cream paper, and restrained cinematic silhouettes unique to this mapmaker's world.",
          characters: [
            {
              name: "The mapmaker",
              description:
                "A compact traveler with warm brown skin, a slate-blue hood, a weathered satchel, copper map tools, and a stubborn amber lantern.",
            },
          ],
          ...(illustrationRequest.covers === 1
            ? {
                cover: {
                  prompt: "A portrait cover composition of the amber lantern opening an unmapped road beneath a mineral-blue sky, with calm space for later title typography.",
                  alt_text: "An amber lantern opening an unmapped road",
                  character_roster: [{
                    name: "The mapmaker",
                    count: 1,
                    duplicate_justification: "",
                  }],
                },
              }
            : {}),
          chapter_heroes: Array.from({ length: heroCount }, (_, index) => ({
            chapter_number: index + 1,
            prompt: `A wide defining chapter-opening moment for the mapmaker and amber lantern in chapter ${index + 1}, with a visually specific environment and emotional beat.`,
            alt_text: `The mapmaker and lantern opening chapter ${index + 1}`,
            character_roster: [{
              name: "The mapmaker",
              count: 1,
              duplicate_justification: "",
            }],
          })),
          inline_illustrations: Array.from(
            {
              length: Number.isInteger(inlinePerChapter)
                ? targetChapters * inlinePerChapter
                : illustrationRequest.inline_count ?? 0,
            },
            (_, index) => {
              const chapterIndex = Number.isInteger(inlinePerChapter) && inlinePerChapter > 0
                ? Math.floor(index / inlinePerChapter)
                : index % targetChapters;
              const sceneIndex = Number.isInteger(inlinePerChapter) && inlinePerChapter > 0
                ? index % inlinePerChapter
                : Math.floor(index / targetChapters);
              return {
                chapter_number: chapterIndex + 1,
                after_block_index: sceneIndex % 2,
                align: sceneIndex % 3 === 2 ? "plate" : sceneIndex % 2 === 0 ? "left" : "right",
                prompt: `The mapmaker follows the amber lantern through inline story moment ${sceneIndex + 1} in chapter ${chapterIndex + 1}, with a visually specific environment and emotional beat.`,
                alt_text: `The mapmaker and lantern at chapter ${chapterIndex + 1} inline moment ${sceneIndex + 1}`,
                character_roster: [{
                  name: "The mapmaker",
                  count: 1,
                  duplicate_justification: "",
                }],
              };
            },
          ),
        }
      : {}),
  };
}

function tinyWebp(label) {
  const payload = Buffer.from(`VP8 ${label.padEnd(12, "!")}`, "ascii");
  const buffer = Buffer.alloc(12 + payload.length);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WEBP", 8, "ascii");
  payload.copy(buffer, 12);
  return buffer;
}

async function validProviderWebp(label) {
  const color = crypto.createHash("sha256").update(label).digest();
  return sharp({
    create: {
      width: 48,
      height: 48,
      channels: 3,
      background: { r: color[0], g: color[1], b: color[2] },
    },
  }).webp({ quality: 70 }).toBuffer();
}

function makeOpenAIMock({
  inputDecision = "safe",
  outputDecision = "safe",
  imageDecision = "safe",
  failImage = 0,
  storyFactory = mockStory,
  characterBibleFactory = null,
} = {}) {
  const calls = [];
  let textModerationCalls = 0;
  let imageCalls = 0;
  let referenceCalls = 0;
  let editCalls = 0;

  const fetchImpl = async (url, options) => {
    assert.ok(
      [
        "https://api.openai.com/v1/moderations",
        "https://api.openai.com/v1/responses",
        "https://api.openai.com/v1/images/generations",
        "https://api.openai.com/v1/images/edits",
      ].includes(url),
      `unexpected upstream URL: ${url}`,
    );
    assert.equal(options.headers.Authorization, `Bearer ${TEST_KEY}`);

    if (url.endsWith("/moderations")) {
      const body = JSON.parse(options.body);
      const isImage = Array.isArray(body.input) && body.input.every((item) => item?.type === "image_url");
      const decision = isImage
        ? imageDecision
        : ++textModerationCalls === 1
          ? inputDecision
          : outputDecision;
      calls.push({ url, body });
      const hard = decision === "reject";
      const review = decision === "review";
      const inputCount = Array.isArray(body.input) ? body.input.length : 1;
      return Response.json({
        id: `modr-${calls.length}`,
        model: "omni-moderation-latest",
        results: Array.from({ length: inputCount }, () => ({
          flagged: hard || review,
          categories: {
            sexual: hard,
            "sexual/minors": false,
            violence: review,
            "violence/graphic": false,
          },
          category_scores: {
            sexual: hard ? 0.99 : 0.001,
            violence: review ? 0.91 : 0.01,
          },
        })),
      });
    }

    if (url.endsWith("/responses")) {
      const body = JSON.parse(options.body);
      calls.push({ url, body });
      const completedResponse = (outputText) => Response.json({
        id: `resp_test_${calls.length}`,
        status: "completed",
        output_text: outputText,
      });
      assert.ok(["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"].includes(body.model));
      assert.deepEqual(body.reasoning, {
        effort: {
          "gpt-5.6-luna": "low",
          "gpt-5.6-terra": "medium",
          "gpt-5.6-sol": "high",
        }[body.model],
      });
      assert.equal(body.store, false);
      assert.equal(body.background, true);
      assert.equal(body.text.format.type, "json_schema");
      assert.equal(body.text.format.strict, true);
      assert.match(body.safety_identifier, /^[a-f0-9]{64}$/);
      const userPayload = JSON.parse(body.input[1].content);
      if (body.text.format.name === "storybook_scrolls_source_digest") {
        return completedResponse(JSON.stringify({
            section_position: `Section ${userPayload.section_number} of ${userPayload.section_count}`,
            events: [`A faithful event from section ${userPayload.section_number}.`],
            causal_links: ["The preceding choice causes the next consequence."],
            character_development: ["The central character changes while remaining recognizable."],
            themes_and_motifs: ["Memory and responsibility continue through the section."],
            unresolved_threads: userPayload.section_number < userPayload.section_count
              ? ["A promise remains unresolved for the next section."]
              : [],
            ending_state: "The cast and conflicts are positioned precisely for the following section.",
          }));
      }
      if (["storybook_scrolls_story_refinement", "storybook_scrolls_age_suitability_audit"].includes(body.text.format.name)) {
        return completedResponse(JSON.stringify(userPayload.current_package));
      }
      if (body.text.format.name === "storybook_scrolls_character_bible") {
        return completedResponse(JSON.stringify(characterBibleFactory?.(userPayload) ?? {
              visual_bible: "Dry-brush walnut ink, sea-glass watercolor, warm paper grain, and moonlit amber practical light define one coherent story world.",
              characters: [{
                name: "The mapmaker",
                description: "A compact traveler with warm brown skin, a slate-blue hood, a weathered satchel, copper map tools, and a stubborn amber lantern.",
              }],
            }));
      }
      return completedResponse(JSON.stringify(
          storyFactory(
            userPayload.target_chapters,
            userPayload.interior_illustrations.chapter_heroes,
            userPayload.interior_illustrations.inline_per_chapter,
            userPayload.interior_illustrations,
          ),
        ));
    }

    imageCalls += 1;
    if (url.endsWith("/generations")) {
      referenceCalls += 1;
      const body = JSON.parse(options.body);
      calls.push({ url, body });
      assert.equal(body.model, "gpt-image-2");
      assert.equal(body.quality, "low");
      assert.equal(body.size, "1024x1024");
      assert.equal(body.output_format, "webp");
      assert.match(body.user, /^[a-f0-9]{64}$/);
    } else {
      editCalls += 1;
      const form = options.body;
      const body = Object.fromEntries([...form.entries()].filter(([name]) => name !== "image"));
      const reference = form.get("image");
      const referenceSha256 = reference
        ? crypto.createHash("sha256").update(Buffer.from(await reference.arrayBuffer())).digest("hex")
        : null;
      calls.push({
        url,
        body,
        imageFieldNames: [...new Set([...form.keys()].filter((name) => name.startsWith("image")))],
        references: form.getAll("image").length,
        referenceSha256,
      });
      assert.equal(form.get("model"), "gpt-image-2");
      assert.equal(form.get("quality"), "low");
      assert.ok(["1536x1024", "1024x1536"].includes(form.get("size")));
      assert.equal(form.get("output_format"), "webp");
      assert.equal(form.getAll("image").length, 1);
      assert.equal(form.has("image[]"), false);
      assert.match(form.get("user"), /^[a-f0-9]{64}$/);
    }
    if (failImage === imageCalls) {
      return Response.json({ error: { message: `failure must not echo ${TEST_KEY}` } }, { status: 400 });
    }
    return Response.json({
      data: [{ b64_json: (await validProviderWebp(`image-${imageCalls}`)).toString("base64") }],
    });
  };

  return {
    fetchImpl,
    calls,
    get imageCalls() {
      return imageCalls;
    },
    get referenceCalls() {
      return referenceCalls;
    },
    get editCalls() {
      return editCalls;
    },
  };
}

function createBody(overrides = {}) {
  return {
    authorDisplayName: "Test Author",
    creativeBrief: "A gentle fantasy journey along a road that no map has ever shown.",
    rights: {
      basis: "own",
      confirmed: true,
      statement: "I wrote the supplied idea.",
      sourceUrls: [],
    },
    sharing: { requestPublic: true },
    generation: {
      confirmed: true,
      targetChapters: 1,
      targetWordsPerChapter: 300,
      visualStyle: "ink, watercolor, and quiet amber moonlight",
      themeId: "irish",
      cleanup: { leadingNoteDelimiters: ["square"] },
      illustrations: { mode: "none" },
    },
    ...overrides,
  };
}

function publicDomainEstimateBody(ebookId = 1342) {
  const base = createBody();
  return createBody({
    source: { kind: "gutenberg", gutenbergId: ebookId },
    creativeBrief: "Preserve the novel while making its language welcoming to a modern reader.",
    rights: {
      basis: "public_domain",
      confirmed: true,
      statement: "This source transcription is unrestricted by United States copyright law.",
      sourceUrls: [`https://www.gutenberg.org/ebooks/${ebookId}`],
    },
    generation: {
      ...base.generation,
      writingTier: "economy",
      imageTier: "draft",
      transformation: { mode: "summary", summaryLevel: "balanced" },
      illustrations: { mode: "ai", density: "light" },
    },
  });
}

function publicDomainCatalogRecord(ebookId = 1342) {
  return {
    id: ebookId,
    title: "Pride and Prejudice",
    authors: [{ name: "Austen, Jane" }],
    languages: ["en"],
    download_count: 123,
  };
}

function mirrorManuscript() {
  return `*** START OF THE PROJECT GUTENBERG EBOOK PRIDE AND PREJUDICE ***\n${"It is a truth retold with causes, choices, and consequences. ".repeat(8)}\n*** END OF THE PROJECT GUTENBERG EBOOK PRIDE AND PREJUDICE ***`;
}

async function startPlatform(mock, options = {}) {
  const dataDir = options.dataDir ?? await fsp.mkdtemp(path.join(os.tmpdir(), "storyscrolls-platform-test-"));
  const logs = [];
  const platform = createPlatformServer({
    dataDir,
    fetchImpl: mock.fetchImpl,
    allowedOrigins: [ORIGIN],
    fingerprintSecret: "test-only-fingerprint-secret",
    createLimit: 20,
    globalCreateLimit: 100,
    reportLimit: 30,
    allowLegacyTextOnly: true,
    asyncCreates: false,
    logger: {
      info: (...args) => logs.push(args),
      error: (...args) => logs.push(args),
    },
    ...options,
  });
  const address = await platform.listen(0);
  assert.equal(address.address, "127.0.0.1");
  return {
    dataDir,
    logs,
    platform,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function postJson(baseUrl, pathname, body, headers = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: {
      Origin: ORIGIN,
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function postMultipart(baseUrl, body, files, headers = {}) {
  const form = new FormData();
  form.append("request", JSON.stringify(body));
  for (const file of files) {
    form.append("illustrations", new Blob([file.bytes], { type: file.type }), file.name);
  }
  return fetch(`${baseUrl}/api/v1/stories`, {
    method: "POST",
    headers: { Origin: ORIGIN, ...headers },
    body: form,
  });
}

async function waitForCreationJob(baseUrl, jobId, { timeoutMs = 10_000, headers = {} } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/v1/jobs/${jobId}`, { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const payload = await response.json();
    if (payload.job.status !== "running") return payload;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`creation job ${jobId} did not finish within ${timeoutMs}ms`);
}

function seedCreatorSession(databasePath, secret, now = Date.now()) {
  const db = new Database(databasePath);
  const userId = crypto.randomUUID();
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const csrfToken = crypto
    .createHmac("sha256", secret)
    .update(`csrf:${rawToken}`)
    .digest("base64url");
  const timestamp = new Date(now).toISOString();
  db.prepare(`
    INSERT INTO users (
      id, google_subject, email_fingerprint, display_name, role, created_at, last_login_at
    ) VALUES (?, ?, ?, ?, 'creator', ?, ?)
  `).run(userId, `google-${userId}`, `email-${userId}`, "Test Creator", timestamp, timestamp);
  db.prepare(`
    INSERT INTO auth_sessions (
      token_hash, user_id, issued_at, expires_at, last_seen_at, csrf_secret_hash, device_label
    ) VALUES (?, ?, ?, ?, ?, ?, 'test')
  `).run(
    crypto.createHash("sha256").update(rawToken).digest("hex"),
    userId,
    timestamp,
    new Date(now + 60 * 60 * 1_000).toISOString(),
    timestamp,
    crypto.createHash("sha256").update(csrfToken).digest("hex"),
  );
  db.close();
  return {
    userId,
    rawToken,
    csrfToken,
    headers: {
      Cookie: `__Host-storyscrolls.sid=${encodeURIComponent(rawToken)}`,
      "X-CSRF-Token": csrfToken,
    },
  };
}

function readAllFiles(root) {
  const values = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) values.push(...readAllFiles(absolute));
    else values.push(fs.readFileSync(absolute));
  }
  return values;
}

test("platform defaults are scoped to the public The Story Scrolls host, data store, and generic themes", async () => {
  const source = await fsp.readFile(
    new URL("../server/platform-server.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /_data\/thestoryscrolls\//);
  assert.match(source, /"https:\/\/thestoryscrolls\.com"/);
  assert.match(source, /"https:\/\/www\.thestoryscrolls\.com"/);
  assert.match(source, /THEMES = new Set\(\["irish", "manuscript", "gemstone", "stained-glass"\]\)/);
  const legacyPattern = new RegExp(["inn" + "keeper", "wandering" + "-inn", "chapter" + "-catalog"].join("|"), "i");
  assert.doesNotMatch(source, legacyPattern);
});

test("a selected illuminated set controls protected story initials and persists its version", async () => {
  const mock = makeOpenAIMock();
  const context = await startPlatform(mock);
  try {
    const base = createBody();
    const selectedSetId = "illuminatedletters:seven-stone-reliquary-gold";
    const response = await postJson(
      context.baseUrl,
      "/api/v1/stories",
      createBody({
        generation: {
          ...base.generation,
          illuminatedSetId: selectedSetId,
        },
      }),
      { Authorization: `Bearer ${TEST_KEY}` },
    );
    assert.equal(response.status, 201);
    const created = await response.json();
    const storyResponse = await fetch(
      `${context.baseUrl}/api/v1/stories/${created.story.slug}`,
    );
    assert.equal(storyResponse.status, 200);
    const { story } = await storyResponse.json();
    assert.equal(story.generation.illuminatedSetId, selectedSetId);
    assert.equal(story.generation.illuminatedSetName, "Seven-Stone Reliquary Gold");
    assert.equal(story.generation.illuminatedSetVersion, 1);
    assert.match(story.generation.illuminatedCatalogVersion, /^[a-f0-9]{64}$/);
    assert.equal(
      story.generation.illuminatedDerivativePolicy,
      "used-initials-only-384px-opaque-paths",
    );
    assert.deepEqual(Object.keys(story.generation.illuminatedGlyphs), ["t"]);
    const glyphPath = story.generation.illuminatedGlyphs.t;
    assert.match(
      glyphPath,
      /^\/media\/community\/[0-9a-f-]{36}\/[a-f0-9]{40}\.webp$/,
    );
    assert.equal(story.assets.length, 0, "protected initials must not masquerade as story art");
    const glyphResponse = await fetch(`${context.baseUrl}${glyphPath}`);
    assert.equal(glyphResponse.status, 200);
    assert.equal(glyphResponse.headers.get("content-type"), "image/webp");
    const metadata = await sharp(Buffer.from(await glyphResponse.arrayBuffer())).metadata();
    assert.ok((metadata.width ?? 0) <= 384);
    assert.ok((metadata.height ?? 0) <= 384);
    assert.equal(metadata.hasAlpha, true);

    const db = new Database(context.platform.databasePath);
    const stored = db.prepare(
      "SELECT filename, model FROM story_assets WHERE story_id = ?",
    ).all(glyphPath.split("/")[3]);
    db.close();
    assert.deepEqual(stored.map(({ model }) => model), ["illuminated-letters-initial-v1"]);
    assert.match(stored[0].filename, /^[a-f0-9]{40}\.webp$/);
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("an unknown illuminated set is rejected before any paid provider call", async () => {
  const mock = makeOpenAIMock();
  const context = await startPlatform(mock);
  try {
    const base = createBody();
    const response = await postJson(
      context.baseUrl,
      "/api/v1/stories",
      createBody({
        generation: {
          ...base.generation,
          illuminatedSetId: "illuminatedletters:this-set-does-not-exist",
        },
      }),
      { Authorization: `Bearer ${TEST_KEY}` },
    );
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_ILLUMINATED_SET");
    assert.equal(mock.calls.length, 0);
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("async creation returns 202, exposes a pollable result, and never persists the BYOK key", async () => {
  const mock = makeOpenAIMock();
  const context = await startPlatform(mock, { asyncCreates: true });
  try {
    const accepted = await postJson(
      context.baseUrl,
      "/api/v1/stories",
      createBody(),
      {
        Authorization: `Bearer ${TEST_KEY}`,
        "Idempotency-Key": crypto.randomUUID(),
      },
    );
    assert.equal(accepted.status, 202);
    assert.match(accepted.headers.get("location") || "", /^\/api\/v1\/jobs\/[0-9a-f-]{36}$/);
    const initial = await accepted.json();
    assert.equal(initial.job.status, "running");
    assert.equal(initial.job.stage, "queued");
    assert.doesNotMatch(JSON.stringify(initial), new RegExp(TEST_KEY.replaceAll("-", "\\-")));
    const completed = await waitForCreationJob(context.baseUrl, initial.job.id);
    assert.equal(completed.job.status, "completed");
    assert.equal(completed.result.story.title, "The Lantern Road");
    assert.equal(completed.result.story.job.id, initial.job.id);
    assert.equal(JSON.stringify(completed).includes('"token":'), false);
    assert.doesNotMatch(JSON.stringify(completed), new RegExp(TEST_KEY.replaceAll("-", "\\-")));
    assert.ok(context.logs.every((entry) => !JSON.stringify(entry).includes(TEST_KEY)));
    assert.ok(readAllFiles(context.dataDir).every((bytes) => !bytes.includes(TEST_KEY)));
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("async creation advances from input moderation to writing while the story response is pending", async () => {
  const upstream = makeOpenAIMock();
  let releaseStory;
  let markStoryStarted;
  const storyStarted = new Promise((resolve) => { markStoryStarted = resolve; });
  const storyGate = new Promise((resolve) => { releaseStory = resolve; });
  const mock = {
    fetchImpl: async (url, options) => {
      if (url.endsWith("/responses")) {
        markStoryStarted();
        await storyGate;
      }
      return upstream.fetchImpl(url, options);
    },
  };
  const context = await startPlatform(mock, { asyncCreates: true });
  try {
    const accepted = await postJson(
      context.baseUrl,
      "/api/v1/stories",
      createBody(),
      {
        Authorization: `Bearer ${TEST_KEY}`,
        "Idempotency-Key": crypto.randomUUID(),
      },
    );
    assert.equal(accepted.status, 202);
    const { job } = await accepted.json();
    await storyStarted;

    const pending = await fetch(`${context.baseUrl}/api/v1/jobs/${job.id}`).then((response) => response.json());
    assert.equal(pending.job.status, "running");
    assert.equal(pending.job.stage, "writing-story");

    releaseStory();
    const completed = await waitForCreationJob(context.baseUrl, job.id);
    assert.equal(completed.job.status, "completed");
  } finally {
    releaseStory?.();
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("async creation records redacted moderation-provider diagnostics without reflecting them to the creator", async () => {
  const upstream = makeOpenAIMock();
  let moderationCalls = 0;
  const privateProviderMessage = `private output-moderation detail ${TEST_KEY}`;
  const mock = {
    fetchImpl: async (url, options) => {
      if (url.endsWith("/moderations") && ++moderationCalls === 2) {
        return new Response(JSON.stringify({
          error: {
            code: "request_too_large",
            type: "invalid_request_error",
            message: privateProviderMessage,
          },
        }), {
          status: 413,
          headers: {
            "content-type": "application/json",
            "x-request-id": "req_output_moderation_413",
          },
        });
      }
      return upstream.fetchImpl(url, options);
    },
  };
  const context = await startPlatform(mock, { asyncCreates: true });
  try {
    const accepted = await postJson(
      context.baseUrl,
      "/api/v1/stories",
      createBody(),
      {
        Authorization: `Bearer ${TEST_KEY}`,
        "Idempotency-Key": crypto.randomUUID(),
      },
    );
    assert.equal(accepted.status, 202);
    const { job } = await accepted.json();
    const failed = await waitForCreationJob(context.baseUrl, job.id);

    assert.equal(failed.job.status, "failed");
    assert.equal(failed.job.stage, "failed");
    assert.deepEqual(failed.job.error, {
      code: "OPENAI_ERROR",
      message: "OpenAI could not complete this request.",
    });
    assert.deepEqual(
      context.logs.filter(([event]) => event === "openai provider failure"),
      [["openai provider failure", {
        endpointClass: "moderation",
        status: 413,
        requestId: "req_output_moderation_413",
        errorCode: "request_too_large",
        errorType: "invalid_request_error",
      }]],
    );
    const serialized = JSON.stringify({ failed, logs: context.logs });
    assert.equal(serialized.includes(privateProviderMessage), false);
    assert.equal(serialized.includes(TEST_KEY), false);
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("idempotent retries reuse one paid run and reject a changed request body", async () => {
  const upstream = makeOpenAIMock();
  let releaseModeration;
  let markModerationStarted;
  const moderationStarted = new Promise((resolve) => { markModerationStarted = resolve; });
  const moderationGate = new Promise((resolve) => { releaseModeration = resolve; });
  let gated = false;
  const mock = {
    fetchImpl: async (url, options) => {
      if (!gated && url.endsWith("/moderations")) {
        gated = true;
        markModerationStarted();
        await moderationGate;
      }
      return upstream.fetchImpl(url, options);
    },
  };
  const context = await startPlatform(mock, { asyncCreates: true });
  const idempotencyKey = crypto.randomUUID();
  const headers = { Authorization: `Bearer ${TEST_KEY}`, "Idempotency-Key": idempotencyKey };
  try {
    const first = await postJson(context.baseUrl, "/api/v1/stories", createBody(), headers);
    assert.equal(first.status, 202);
    const firstPayload = await first.json();
    await moderationStarted;

    const retry = await postJson(context.baseUrl, "/api/v1/stories", createBody(), headers);
    assert.equal(retry.status, 202);
    assert.equal((await retry.json()).job.id, firstPayload.job.id);

    const conflict = await postJson(
      context.baseUrl,
      "/api/v1/stories",
      createBody({ creativeBrief: "A materially different story request that must never share paid work." }),
      headers,
    );
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).error.code, "IDEMPOTENCY_CONFLICT");

    releaseModeration();
    const completed = await waitForCreationJob(context.baseUrl, firstPayload.job.id);
    assert.equal(completed.job.status, "completed");
    const db = new Database(context.platform.databasePath, { readonly: true });
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM creation_jobs").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM stories").get().count, 1);
    db.close();
    assert.equal(
      upstream.calls.filter(({ url }) => String(url).endsWith("/responses")).length,
      1,
    );
  } finally {
    releaseModeration?.();
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("shutdown and startup turn unfinished in-memory jobs into durable retry-required failures", async () => {
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const mock = {
    fetchImpl: async (_url, options) => {
      markStarted();
      await new Promise((resolve, reject) => {
        if (options.signal.aborted) {
          reject(options.signal.reason);
          return;
        }
        options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
      });
      throw new Error("unreachable");
    },
  };
  const context = await startPlatform(mock, { asyncCreates: true });
  let closed = false;
  let restarted = null;
  try {
    const accepted = await postJson(
      context.baseUrl,
      "/api/v1/stories",
      createBody(),
      { Authorization: `Bearer ${TEST_KEY}`, "Idempotency-Key": crypto.randomUUID() },
    );
    assert.equal(accepted.status, 202);
    const { job } = await accepted.json();
    await started;
    await context.platform.close();
    closed = true;

    let db = new Database(context.platform.databasePath);
    let row = db.prepare("SELECT status, stage, error_code FROM creation_jobs WHERE id = ?").get(job.id);
    assert.deepEqual(row, {
      status: "failed",
      stage: "retry-required",
      error_code: "PROCESS_INTERRUPTED",
    });
    db.prepare("UPDATE creation_jobs SET status = 'running', stage = 'provider-request', error_code = NULL WHERE id = ?").run(job.id);
    db.close();

    restarted = createPlatformServer({
      dataDir: context.dataDir,
      fetchImpl: mock.fetchImpl,
      allowedOrigins: [ORIGIN],
      fingerprintSecret: "test-only-fingerprint-secret",
      asyncCreates: true,
    });
    db = new Database(restarted.databasePath, { readonly: true });
    row = db.prepare("SELECT status, stage, error_code FROM creation_jobs WHERE id = ?").get(job.id);
    assert.deepEqual(row, {
      status: "failed",
      stage: "retry-required",
      error_code: "PROCESS_INTERRUPTED",
    });
    db.close();
    assert.ok(readAllFiles(context.dataDir).every((bytes) => !bytes.includes(TEST_KEY)));
  } finally {
    if (restarted) await restarted.close();
    if (!closed) await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("explicit source lanes receive a server-signed, owner-bound cost approval", async () => {
  const mock = makeOpenAIMock();
  const context = await startPlatform(mock);
  const sourceText = "A public-domain-sized manuscript passage with enough detail to be safely adapted. ".repeat(3);
  const base = createBody();
  const payload = createBody({
    source: { kind: "pasted" },
    sourceText,
    creativeBrief: undefined,
    rights: {
      basis: "own",
      confirmed: true,
      artConfirmed: true,
      artCredit: "Test Artist",
      statement: "I own this manuscript and the artwork I would upload.",
      sourceUrls: [],
    },
    generation: {
      ...base.generation,
      writingTier: "balanced",
      imageTier: "standard",
      illustrations: { mode: "upload" },
    },
  });
  try {
    const estimated = await postJson(context.baseUrl, "/api/v1/estimates", payload);
    assert.equal(estimated.status, 200);
    const result = await estimated.json();
    assert.equal(result.estimate.inputs.writingModel, "gpt-5.6-terra");
    assert.equal(result.estimate.inputs.imageModel, null);
    assert.match(result.approval.token, /^[A-Za-z0-9_-]{40,}$/);

    const tampered = structuredClone(payload);
    tampered.generation.estimateApproval = {
      ...result.approval,
      token: `${result.approval.token.slice(0, -1)}${result.approval.token.endsWith("A") ? "B" : "A"}`,
    };
    const rejected = await postJson(
      context.baseUrl,
      "/api/v1/stories",
      tampered,
      { Authorization: `Bearer ${TEST_KEY}` },
    );
    assert.equal(rejected.status, 409);
    assert.equal((await rejected.json()).error.code, "ESTIMATE_CHANGED");

    const approved = structuredClone(payload);
    approved.generation.estimateApproval = result.approval;
    const reachesArtworkValidation = await postJson(
      context.baseUrl,
      "/api/v1/stories",
      approved,
      { Authorization: `Bearer ${TEST_KEY}` },
    );
    assert.equal(reachesArtworkValidation.status, 400);
    assert.equal((await reachesArtworkValidation.json()).error.code, "INVALID_IMAGE_UPLOAD");
    assert.equal(mock.calls.length, 0);
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("best-effort spend caps reject below the conservative maximum before any job or OpenAI call", async () => {
  const mock = makeOpenAIMock();
  const context = await startPlatform(mock);
  try {
    const base = createBody();
    const plan = createBody({
      sharing: { requestPublic: false },
      generation: {
        ...base.generation,
        qualityLevel: 4,
        targetChapters: 2,
        targetWordsPerChapter: 2_000,
      },
    });
    const estimateResponse = await postJson(context.baseUrl, "/api/v1/estimates", plan);
    assert.equal(estimateResponse.status, 200);
    const estimate = await estimateResponse.json();
    assert.ok(estimate.estimate.estimatedMaxUsd > 0.01);

    const capped = structuredClone(plan);
    capped.generation.estimateApproval = estimate.approval;
    capped.generation.spendCapUsd = Number((estimate.estimate.estimatedMaxUsd - 0.01).toFixed(2));
    const rejected = await postJson(
      context.baseUrl,
      "/api/v1/stories",
      capped,
      { Authorization: `Bearer ${TEST_KEY}` },
    );
    assert.equal(rejected.status, 409);
    const error = (await rejected.json()).error;
    assert.equal(error.code, "SPEND_CAP_EXCEEDED");
    assert.deepEqual(error.details, {
      currentCapUsd: capped.generation.spendCapUsd,
      requiredEstimatedMaxUsd: estimate.estimate.estimatedMaxUsd,
      minimumIllustratedContractComplete: false,
      enforcementScope: "preflight_estimate",
    });
    assert.deepEqual(error.actions, ["increase_cap", "reduce_quality_or_art"]);
    assert.match(error.message, /No generation work was started/);
    assert.equal(mock.calls.length, 0);

    const db = new Database(context.platform.databasePath, { readonly: true });
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM creation_jobs").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM stories").get().count, 0);
    db.close();
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("spend caps equal to or above the conservative maximum allow the signed plan", async () => {
  for (const extraUsd of [0, 1]) {
    const mock = makeOpenAIMock();
    const context = await startPlatform(mock);
    try {
      const plan = createBody({ sharing: { requestPublic: false } });
      const estimate = await postJson(context.baseUrl, "/api/v1/estimates", plan).then(
        (response) => response.json(),
      );
      plan.generation.estimateApproval = estimate.approval;
      plan.generation.spendCapUsd = Number(
        (estimate.estimate.estimatedMaxUsd + extraUsd).toFixed(2),
      );
      const response = await postJson(
        context.baseUrl,
        "/api/v1/stories",
        plan,
        { Authorization: `Bearer ${TEST_KEY}` },
      );
      assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
      assert.ok(mock.calls.some(({ url }) => url.endsWith("/responses")));
      const db = new Database(context.platform.databasePath, { readonly: true });
      const stored = JSON.parse(db.prepare("SELECT estimate_json FROM stories LIMIT 1").get().estimate_json);
      assert.equal(stored.spendCapUsd, plan.generation.spendCapUsd);
      assert.equal(stored.spendCapEnforcementScope, "preflight_conservative_estimate_maximum");
      db.close();
    } finally {
      await context.platform.close();
      await fsp.rm(context.dataDir, { recursive: true, force: true });
    }
  }
});

test("invalid, stale, and tampered spend-cap plans cannot reach OpenAI or create a job", async () => {
  const mock = makeOpenAIMock();
  const context = await startPlatform(mock);
  try {
    const base = createBody({ sharing: { requestPublic: false } });
    const lowPlan = createBody({
      sharing: { requestPublic: false },
      generation: { ...base.generation, qualityLevel: 0 },
    });
    const highPlan = createBody({
      sharing: { requestPublic: false },
      generation: { ...base.generation, qualityLevel: 4 },
    });
    const lowEstimate = await postJson(context.baseUrl, "/api/v1/estimates", lowPlan).then(
      (response) => response.json(),
    );
    const highEstimate = await postJson(context.baseUrl, "/api/v1/estimates", highPlan).then(
      (response) => response.json(),
    );

    const stale = structuredClone(highPlan);
    stale.generation.estimateApproval = lowEstimate.approval;
    stale.generation.spendCapUsd = lowEstimate.estimate.estimatedMaxUsd;
    const staleResponse = await postJson(
      context.baseUrl,
      "/api/v1/stories",
      stale,
      { Authorization: `Bearer ${TEST_KEY}` },
    );
    assert.equal(staleResponse.status, 409);
    assert.equal((await staleResponse.json()).error.code, "SPEND_CAP_EXCEEDED");

    const tampered = structuredClone(highPlan);
    tampered.generation.estimateApproval = {
      ...lowEstimate.approval,
      estimatedMaxUsd: highEstimate.estimate.estimatedMaxUsd,
    };
    tampered.generation.spendCapUsd = highEstimate.estimate.estimatedMaxUsd;
    const tamperedResponse = await postJson(
      context.baseUrl,
      "/api/v1/stories",
      tampered,
      { Authorization: `Bearer ${TEST_KEY}` },
    );
    assert.equal(tamperedResponse.status, 409);
    assert.equal((await tamperedResponse.json()).error.code, "ESTIMATE_CHANGED");

    for (const invalidCap of [0, 100_000.001, "25.00"]) {
      const invalid = structuredClone(lowPlan);
      invalid.generation.estimateApproval = lowEstimate.approval;
      invalid.generation.spendCapUsd = invalidCap;
      const response = await postJson(
        context.baseUrl,
        "/api/v1/stories",
        invalid,
        { Authorization: `Bearer ${TEST_KEY}` },
      );
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, "INVALID_SPEND_CAP");
    }

    assert.equal(mock.calls.length, 0);
    const db = new Database(context.platform.databasePath, { readonly: true });
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM creation_jobs").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM stories").get().count, 0);
    db.close();
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("craft quality profiles and custom overrides change real model work and signed cost", async () => {
  const mock = makeOpenAIMock();
  const context = await startPlatform(mock);
  const base = createBody();
  try {
    const sketchPayload = createBody({
      sharing: { requestPublic: false },
      generation: { ...base.generation, qualityLevel: 0 },
    });
    const masterworkPayload = createBody({
      sharing: { requestPublic: false },
      generation: { ...base.generation, qualityLevel: 4 },
    });
    const sketchEstimate = await postJson(context.baseUrl, "/api/v1/estimates", sketchPayload).then((item) => item.json());
    const masterworkEstimate = await postJson(context.baseUrl, "/api/v1/estimates", masterworkPayload).then((item) => item.json());
    assert.equal(sketchEstimate.estimate.inputs.qualityProfile, "sketch");
    assert.equal(sketchEstimate.estimate.inputs.editorialRefinementPasses, 0);
    assert.equal(masterworkEstimate.estimate.inputs.qualityProfile, "masterwork");
    assert.equal(masterworkEstimate.estimate.inputs.writingModel, "gpt-5.6-sol");
    assert.equal(masterworkEstimate.estimate.inputs.editorialRefinementPasses, 3);
    assert.ok(masterworkEstimate.estimate.estimatedMaxUsd > sketchEstimate.estimate.estimatedMaxUsd);
    assert.notEqual(masterworkEstimate.approval.token, sketchEstimate.approval.token);

    const customEstimate = await postJson(context.baseUrl, "/api/v1/estimates", createBody({
      sharing: { requestPublic: false },
      generation: {
        ...base.generation,
        qualityLevel: 1,
        customQuality: {
          writingTier: "literary",
          refinementPasses: 2,
          imageTier: "premium",
          outputSize: "retina",
        },
      },
    })).then((item) => item.json());
    assert.equal(customEstimate.estimate.inputs.qualityProfile, "custom");
    assert.equal(customEstimate.estimate.inputs.editorialRefinementPasses, 2);
    assert.equal(customEstimate.estimate.inputs.outputSize, "retina");

    masterworkPayload.generation.estimateApproval = masterworkEstimate.approval;
    const created = await postJson(
      context.baseUrl,
      "/api/v1/stories",
      masterworkPayload,
      { Authorization: `Bearer ${TEST_KEY}` },
    );
    assert.equal(created.status, 201);
    const result = await created.json();
    assert.equal(result.story.adaptation.qualityProfile, "masterwork");
    assert.equal(result.story.adaptation.refinementPasses, 3);
    assert.equal(result.story.adaptation.textRequestCount, 4);
    const responseCalls = mock.calls.filter(({ url }) => url.endsWith("/responses"));
    assert.equal(responseCalls.length, 4);
    assert.equal(
      responseCalls.filter(({ body }) => body.text.format.name === "storybook_scrolls_story_refinement").length,
      3,
    );
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("the public-domain lane uses the primary mirror, identifies itself, and then reuses its private cache", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/books/?search=")) {
      return Response.json({ results: [publicDomainCatalogRecord()] });
    }
    if (String(url).endsWith("/books/1342/")) {
      return Response.json(publicDomainCatalogRecord());
    }
    if (String(url) === "https://gutenberg.pglaf.org/cache/epub/1342/pg1342.txt") {
      return new Response(mirrorManuscript(), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    throw new Error(`unexpected upstream URL: ${url}`);
  };
  const context = await startPlatform({ fetchImpl, calls });
  try {
    const searched = await fetch(`${context.baseUrl}/api/v1/gutenberg/search?q=pride`);
    assert.equal(searched.status, 200);
    const catalog = await searched.json();
    assert.deepEqual(catalog.books[0], {
      id: 1342,
      title: "Pride and Prejudice",
      authors: ["Austen, Jane"],
      languages: ["en"],
      downloadCount: 123,
      sourceUrl: "https://www.gutenberg.org/ebooks/1342",
    });
    const estimated = await postJson(
      context.baseUrl,
      "/api/v1/estimates",
      publicDomainEstimateBody(),
    );
    assert.equal(estimated.status, 200);
    const estimate = await estimated.json();
    assert.equal(estimate.estimate.inputs.visibleImageCount, 3);
    const primaryCalls = calls.filter(({ url }) => url === "https://gutenberg.pglaf.org/cache/epub/1342/pg1342.txt");
    assert.equal(primaryCalls.length, 1);
    assert.match(primaryCalls[0].options.headers["User-Agent"], /thestoryscrolls\.com\/about/i);
    assert.match(primaryCalls[0].options.headers["User-Agent"], /mailto:/i);
    assert.equal(primaryCalls[0].options.redirect, "error");
    assert.ok(primaryCalls[0].options.signal instanceof AbortSignal);
    assert.equal(calls.some(({ url }) => url.startsWith("https://www.gutenberg.org/cache/")), false);

    const cachePath = path.join(context.dataDir, ".source-cache", "1342.txt");
    const cached = await fsp.readFile(cachePath, "utf8");
    assert.doesNotMatch(cached, /Project Gutenberg/i);
    assert.equal((await fsp.stat(cachePath)).mode & 0o777, 0o600);
    assert.equal((await fsp.stat(path.dirname(cachePath))).mode & 0o777, 0o700);

    const cachedEstimate = await postJson(
      context.baseUrl,
      "/api/v1/estimates",
      publicDomainEstimateBody(),
    );
    assert.equal(cachedEstimate.status, 200);
    assert.equal(
      calls.filter(({ url }) => url.includes("/pg1342.txt")).length,
      1,
      "the second import must not contact either text mirror",
    );
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("the public-domain importer rejects a bad primary type and falls back to the ODU mirror in order", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const href = String(url);
    calls.push({ url: href, options });
    if (href.endsWith("/books/1342/")) return Response.json(publicDomainCatalogRecord());
    if (href === "https://gutenberg.pglaf.org/cache/epub/1342/pg1342.txt") {
      return new Response("<html>not a manuscript</html>", {
        headers: { "Content-Type": "text/html" },
      });
    }
    if (href === "https://mirror.cs.odu.edu/gutenberg-epub/1342/pg1342.txt") {
      return new Response(mirrorManuscript(), {
        headers: { "Content-Type": "text/plain" },
      });
    }
    throw new Error(`unexpected upstream URL: ${url}`);
  };
  const context = await startPlatform({ fetchImpl, calls });
  try {
    const response = await postJson(
      context.baseUrl,
      "/api/v1/estimates",
      publicDomainEstimateBody(),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(
      calls.filter(({ url }) => url.includes("/pg1342.txt")).map(({ url }) => url),
      [
        "https://gutenberg.pglaf.org/cache/epub/1342/pg1342.txt",
        "https://mirror.cs.odu.edu/gutenberg-epub/1342/pg1342.txt",
      ],
    );
    assert.equal(calls.some(({ url }) => url.startsWith("https://www.gutenberg.org/cache/")), false);
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("the public-domain importer times out a stalled primary mirror before using its fallback", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const href = String(url);
    calls.push({ url: href, options });
    if (href.endsWith("/books/1342/")) return Response.json(publicDomainCatalogRecord());
    if (href === "https://gutenberg.pglaf.org/cache/epub/1342/pg1342.txt") {
      return new Promise((resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      });
    }
    if (href === "https://mirror.cs.odu.edu/gutenberg-epub/1342/pg1342.txt") {
      return new Response(mirrorManuscript(), { headers: { "Content-Type": "text/plain" } });
    }
    throw new Error(`unexpected upstream URL: ${url}`);
  };
  const context = await startPlatform(
    { fetchImpl, calls },
    { sourceFetchTimeoutMs: 5 },
  );
  try {
    const response = await postJson(
      context.baseUrl,
      "/api/v1/estimates",
      publicDomainEstimateBody(),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(
      calls.filter(({ url }) => url.includes("/pg1342.txt")).map(({ url }) => url),
      [
        "https://gutenberg.pglaf.org/cache/epub/1342/pg1342.txt",
        "https://mirror.cs.odu.edu/gutenberg-epub/1342/pg1342.txt",
      ],
    );
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("the public-domain importer fails gracefully after both mirrors reject the bounded request and never hits the main site", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const href = String(url);
    calls.push({ url: href, options });
    if (href.endsWith("/books/1342/")) return Response.json(publicDomainCatalogRecord());
    if (href === "https://gutenberg.pglaf.org/cache/epub/1342/pg1342.txt") {
      return new Response("mirror unavailable", {
        status: 503,
        headers: { "Content-Type": "text/plain" },
      });
    }
    if (href === "https://mirror.cs.odu.edu/gutenberg-epub/1342/pg1342.txt") {
      return new Response("too large", {
        headers: {
          "Content-Type": "text/plain",
          "Content-Length": String(8 * 1024 * 1024 + 1),
        },
      });
    }
    throw new Error(`unexpected upstream URL: ${url}`);
  };
  const context = await startPlatform({ fetchImpl, calls });
  try {
    const response = await postJson(
      context.baseUrl,
      "/api/v1/estimates",
      publicDomainEstimateBody(),
    );
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("retry-after"), "60");
    assert.deepEqual(await response.json(), {
      error: {
        code: "PUBLIC_DOMAIN_SOURCE_UNAVAILABLE",
        message: "This public-domain source is temporarily unavailable. Please try again shortly.",
      },
    });
    assert.deepEqual(
      calls.filter(({ url }) => url.includes("/pg1342.txt")).map(({ url }) => url),
      [
        "https://gutenberg.pglaf.org/cache/epub/1342/pg1342.txt",
        "https://mirror.cs.odu.edu/gutenberg-epub/1342/pg1342.txt",
      ],
    );
    assert.equal(calls.some(({ url }) => url.startsWith("https://www.gutenberg.org/cache/")), false);
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("character references are isolated to their creator and require explicit approval before reuse", async () => {
  const mock = makeOpenAIMock();
  const context = await startPlatform(mock);
  const sessionA = "creator-session-aaaaaaaa";
  const sessionB = "creator-session-bbbbbbbb";
  const creativeBrief = "A young mapmaker follows a stubborn lantern along a road that appears only when someone chooses kindness over certainty.";
  const sourceText = `${"A ﬂame-lit map records each choice without changing the road.\r\n".repeat(4)}The ending remains exactly where the traveler left it.`;
  const visualStyle = "dry-brush ink and luminous watercolor";
  const base = createBody();
  const creationPayload = createBody({
    source: { kind: "brief" },
    creativeBrief,
    sourceText,
    sharing: { visibility: "unlisted", requestPublic: false },
    generation: {
      ...base.generation,
      writingTier: "balanced",
      imageTier: "draft",
      outputSize: "web",
      visualStyle,
      audience: { targetAge: null, format: "prose" },
      transformation: {
        mode: "faithful",
        summaryLevel: "balanced",
        modernization: "none",
        reimagination: {
          enabled: false,
          setting: "",
          characterChanges: "",
          plotChanges: "",
          alternateEnding: "",
        },
      },
      illustratedContract: true,
      illustrations: {
        mode: "ai",
        density: "light",
        requiredAssets: { cover: 1, chapterHeroesPerChapter: 1, inlinePerChapter: 1 },
      },
    },
  });
  try {
    const estimated = await postJson(
      context.baseUrl,
      "/api/v1/estimates",
      creationPayload,
      { "X-Storyscrolls-Session": sessionA },
    );
    assert.equal(estimated.status, 200);
    const estimate = await estimated.json();
    assert.equal(estimate.estimate.catalogVersion, "openai-public-2026-07-21");
    assert.equal(estimate.estimate.inputs.visibleImageCount, 3);
    assert.equal(estimate.estimate.inputs.continuityReferenceImages, 1);
    assert.equal(estimate.estimate.inputs.continuityReferenceTier, "draft");
    assert.equal(estimate.estimate.inputs.continuityReferenceQuality, "low");
    assert.equal(estimate.estimate.inputs.continuityReferenceOutputUsd, 0.006);

    const prepared = await postJson(
      context.baseUrl,
      "/api/v1/character-bibles",
      {
        creativeBrief,
        sourceText,
        visualStyle,
        generation: { writingTier: "balanced" },
        audience: { targetAge: null, format: "prose" },
        transformation: creationPayload.generation.transformation,
      },
      {
        Authorization: `Bearer ${TEST_KEY}`,
        "X-Storyscrolls-Session": sessionA,
      },
    );
    assert.equal(prepared.status, 201);
    const guide = (await prepared.json()).characterBible;
    assert.equal(guide.characters[0].name, "The mapmaker");
    assert.match(guide.reference.url, new RegExp(`/api/v1/character-bibles/${guide.id}/reference\\.webp$`));
    assert.equal(guide.reference.quality, "low");
    assert.equal(guide.reference.estimatedOutputUsd, 0.006);
    assert.equal(guide.reference.priceCatalogVersion, "openai-public-2026-07-21");
    assert.equal(guide.reference.approvedAt, null);
    assert.equal(mock.referenceCalls, 1);
    let db = new Database(context.platform.databasePath, { readonly: true });
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM character_bibles").get().count, 0);
    db.close();
    assert.deepEqual(await fsp.readdir(path.join(context.dataDir, "character-references")), []);

    const isolatedReference = await fetch(`${context.baseUrl}${guide.reference.url}`, {
      headers: { "X-Storyscrolls-Session": sessionB },
    });
    assert.equal(isolatedReference.status, 404);
    const referenceResponse = await fetch(`${context.baseUrl}${guide.reference.url}`, {
      headers: { "X-Storyscrolls-Session": sessionA },
    });
    assert.equal(referenceResponse.status, 200);
    assert.equal(referenceResponse.headers.get("cache-control"), "private, no-store");
    assert.equal(referenceResponse.headers.get("content-type"), "image/webp");
    const approvedReferenceBytes = Buffer.from(await referenceResponse.arrayBuffer());
    const approvedReferenceSha256 = crypto.createHash("sha256").update(approvedReferenceBytes).digest("hex");

    const isolated = await postJson(
      context.baseUrl,
      `/api/v1/character-bibles/${guide.id}/approve`,
      { approved: true },
      { "X-Storyscrolls-Session": sessionB },
    );
    assert.equal(isolated.status, 404);

    const approved = await postJson(
      context.baseUrl,
      `/api/v1/character-bibles/${guide.id}/approve`,
      { approved: true },
      { "X-Storyscrolls-Session": sessionA },
    );
    assert.equal(approved.status, 200);
    const approvedBody = await approved.json();
    const approval = approvedBody.approval;
    assert.match(approval.token, /^[A-Za-z0-9_-]{40,}$/);
    assert.match(approvedBody.characterBible.reference.approvedAt, /^\d{4}-\d{2}-\d{2}T/);
    db = new Database(context.platform.databasePath, { readonly: true });
    const approvedRow = db.prepare("SELECT status, plan_json FROM character_bibles WHERE id = ?").get(guide.id);
    assert.equal(approvedRow.status, "approved");
    assert.equal(JSON.parse(approvedRow.plan_json).reference.sha256, approvedReferenceSha256);
    db.close();
    assert.deepEqual(await fsp.readdir(path.join(context.dataDir, "character-references")), [`${guide.id}.webp`]);

    const changedAfterApproval = await postJson(
      context.baseUrl,
      "/api/v1/stories",
      createBody({
        source: { kind: "brief" },
        creativeBrief: "A completely different approved-after-the-fact story about a glass city beneath the sea.",
        generation: {
          ...base.generation,
          visualStyle,
          illustratedContract: true,
          characterBibleApproval: approval,
          illustrations: { mode: "ai", density: "light" },
        },
      }),
      {
        Authorization: `Bearer ${TEST_KEY}`,
        "X-Storyscrolls-Session": sessionA,
      },
    );
    assert.equal(changedAfterApproval.status, 409);
    assert.equal((await changedAfterApproval.json()).error.code, "CHARACTER_BIBLE_INPUT_CHANGED");

    creationPayload.generation.estimateApproval = estimate.approval;
    creationPayload.generation.characterBibleApproval = approval;
    const created = await postJson(
      context.baseUrl,
      "/api/v1/stories",
      creationPayload,
      {
        Authorization: `Bearer ${TEST_KEY}`,
        "X-Storyscrolls-Session": sessionA,
      },
    );
    const createdBody = await created.json();
    assert.equal(created.status, 201, JSON.stringify({ createdBody, logs: context.logs }));
    assert.equal(createdBody.story.adaptation.continuityReferenceApproved, true);
    assert.equal(createdBody.story.adaptation.continuityReferenceTier, "draft");
    assert.equal(createdBody.story.estimateInputs.continuityReferenceApproved, true);
    assert.equal(createdBody.story.estimateInputs.approvedReferenceUsed, true);
    assert.equal(mock.referenceCalls, 1, "final production reuses the approved sheet instead of generating a replacement");
    assert.equal(mock.editCalls, 3);
    const storyRequest = mock.calls.find(
      ({ body }) => body?.text?.format?.name === "storybook_scrolls_story",
    );
    const generatedSchema = storyRequest.body.text.format.schema.properties;
    for (const nameSchema of [
      generatedSchema.cover.properties.character_roster.items.properties.name,
      generatedSchema.chapter_heroes.items.properties.character_roster.items.properties.name,
      generatedSchema.inline_illustrations.items.properties.character_roster.items.properties.name,
    ]) {
      assert.deepEqual(
        nameSchema.enum,
        ["The mapmaker"],
        "approved character names are exact schema enums in every generated scene roster",
      );
    }
    assert.ok(
      mock.calls
        .filter(({ url }) => String(url).endsWith("/images/edits"))
        .every(({ referenceSha256 }) => referenceSha256 === approvedReferenceSha256),
      "every final image edit receives the creator-approved reference bytes",
    );
    db = new Database(context.platform.databasePath, { readonly: true });
    assert.equal(db.prepare("SELECT status FROM character_bibles WHERE id = ?").get(guide.id).status, "used");
    const storyRow = db.prepare("SELECT illustration_policy_json, generation_policy_json, estimate_json FROM stories LIMIT 1").get();
    assert.equal(JSON.parse(storyRow.illustration_policy_json).continuityReferenceApproval.usedForFinalIllustrations, true);
    assert.equal(JSON.parse(storyRow.generation_policy_json).continuityReference.approvedByCreator, true);
    assert.equal(JSON.parse(storyRow.estimate_json).inputs.continuityReferenceImages, 1);
    db.close();
    assert.ok(readAllFiles(context.dataDir).every((bytes) => !bytes.includes(TEST_KEY)));
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("character-guide schema and validation require a protagonist and central recurring cast", async () => {
  const mock = makeOpenAIMock({
    characterBibleFactory: () => ({
      visual_bible: "Walnut ink, mineral watercolor, warm paper grain, and amber light define one coherent illustrated world.",
      characters: [],
    }),
  });
  const context = await startPlatform(mock);
  try {
    const response = await postJson(
      context.baseUrl,
      "/api/v1/character-bibles",
      {
        creativeBrief: "A young mapmaker follows a stubborn lantern beyond the edge of every known road.",
        visualStyle: "dry-brush ink and luminous watercolor",
        generation: { writingTier: "balanced" },
      },
      {
        Authorization: `Bearer ${TEST_KEY}`,
        "X-Storyscrolls-Session": "character-cast-session-123456",
      },
    );
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, "INVALID_MODEL_OUTPUT");
    assert.equal(mock.referenceCalls, 0);
    const characterCall = mock.calls.find(
      ({ url, body }) =>
        url.endsWith("/responses")
        && body.text.format.name === "storybook_scrolls_character_bible",
    );
    assert.ok(characterCall);
    assert.equal(
      characterCall.body.text.format.schema.properties.characters.minItems,
      1,
    );
    assert.match(
      characterCall.body.input[0].content,
      /Always include the protagonist or protagonists and the central recurring cast/,
    );
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("an exact continuity cast is schema-bound, hash-bound, and preserved through final creation", async () => {
  const continuityCharacters = ["Mira Vale", "Tomas Reed"];
  const mock = makeOpenAIMock({
    characterBibleFactory: () => ({
      visual_bible: "Walnut ink, mineral watercolor, warm paper grain, and amber light define one coherent illustrated world.",
      characters: continuityCharacters.map((name) => ({
        name,
        description: `${name} has a distinct silhouette, stable facial structure, signature clothing, and a consistent story palette.`,
      })),
    }),
  });
  const context = await startPlatform(mock);
  const session = "exact-continuity-cast-session";
  const base = createBody();
  const creationPayload = createBody({
    source: { kind: "brief" },
    sharing: { visibility: "unlisted", requestPublic: false },
    generation: {
      ...base.generation,
      writingTier: "balanced",
      imageTier: "draft",
      outputSize: "web",
      illustratedContract: true,
      continuityCharacters,
      audience: { targetAge: null, format: "prose" },
      transformation: { mode: "faithful", summaryLevel: "balanced" },
      illustrations: { mode: "ai", density: "light" },
    },
  });
  try {
    const estimated = await postJson(
      context.baseUrl,
      "/api/v1/estimates",
      creationPayload,
      { "X-Storyscrolls-Session": session },
    );
    assert.equal(estimated.status, 200);
    const estimate = await estimated.json();
    const prepared = await postJson(
      context.baseUrl,
      "/api/v1/character-bibles",
      {
        creativeBrief: creationPayload.creativeBrief,
        visualStyle: creationPayload.generation.visualStyle,
        generation: { writingTier: "balanced", continuityCharacters },
        audience: creationPayload.generation.audience,
        transformation: creationPayload.generation.transformation,
      },
      {
        Authorization: `Bearer ${TEST_KEY}`,
        "X-Storyscrolls-Session": session,
      },
    );
    assert.equal(prepared.status, 201);
    const guide = (await prepared.json()).characterBible;
    assert.deepEqual(guide.characters.map(({ name }) => name), continuityCharacters);
    const characterCall = mock.calls.find(
      ({ url, body }) =>
        url.endsWith("/responses")
        && body.text.format.name === "storybook_scrolls_character_bible",
    );
    const characterSchema = characterCall.body.text.format.schema.properties.characters;
    assert.equal(characterSchema.minItems, 2);
    assert.equal(characterSchema.maxItems, 2);
    assert.deepEqual(characterSchema.items.properties.name.enum, continuityCharacters);
    assert.deepEqual(
      JSON.parse(characterCall.body.input[1].content).continuity_characters,
      continuityCharacters,
    );

    const approved = await postJson(
      context.baseUrl,
      `/api/v1/character-bibles/${guide.id}/approve`,
      { approved: true },
      { "X-Storyscrolls-Session": session },
    );
    assert.equal(approved.status, 200);
    const approval = (await approved.json()).approval;
    creationPayload.generation.estimateApproval = estimate.approval;
    creationPayload.generation.characterBibleApproval = approval;

    const changedCast = structuredClone(creationPayload);
    changedCast.generation.continuityCharacters = ["Mira Vale", "Someone Else"];
    const changed = await postJson(
      context.baseUrl,
      "/api/v1/stories",
      changedCast,
      {
        Authorization: `Bearer ${TEST_KEY}`,
        "X-Storyscrolls-Session": session,
      },
    );
    assert.equal(changed.status, 409);
    assert.equal((await changed.json()).error.code, "CHARACTER_BIBLE_INPUT_CHANGED");

    const created = await postJson(
      context.baseUrl,
      "/api/v1/stories",
      creationPayload,
      {
        Authorization: `Bearer ${TEST_KEY}`,
        "X-Storyscrolls-Session": session,
      },
    );
    const createdBody = await created.json();
    assert.equal(created.status, 201, JSON.stringify(createdBody));
    const db = new Database(context.platform.databasePath, { readonly: true });
    const row = db.prepare("SELECT generation_policy_json FROM stories WHERE slug = ?").get(createdBody.story.slug);
    assert.deepEqual(JSON.parse(row.generation_policy_json).continuityCharacters, continuityCharacters);
    db.close();
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

for (const [label, characters] of [
  ["duplicates", ["Mira Vale", "Mira Vale"]],
  ["missing names", ["Mira Vale"]],
  ["unknown names", ["Mira Vale", "Unknown Wanderer"]],
]) {
  test(`an exact continuity cast rejects ${label} in model output`, async () => {
    const mock = makeOpenAIMock({
      characterBibleFactory: () => ({
        visual_bible: "Walnut ink, mineral watercolor, warm paper grain, and amber light define one coherent illustrated world.",
        characters: characters.map((name) => ({
          name,
          description: `${name} has a stable face, distinct silhouette, signature clothing, and consistent story colors.`,
        })),
      }),
    });
    const context = await startPlatform(mock);
    try {
      const response = await postJson(
        context.baseUrl,
        "/api/v1/character-bibles",
        {
          creativeBrief: "Mira and Tomas follow a lantern beyond the edge of every known road.",
          generation: {
            writingTier: "balanced",
            continuityCharacters: ["Mira Vale", "Tomas Reed"],
          },
        },
        {
          Authorization: `Bearer ${TEST_KEY}`,
          "X-Storyscrolls-Session": `invalid-exact-cast-${label}`,
        },
      );
      assert.equal(response.status, 502);
      assert.equal((await response.json()).error.code, "INVALID_MODEL_OUTPUT");
      assert.equal(mock.referenceCalls, 0);
    } finally {
      await context.platform.close();
      await fsp.rm(context.dataDir, { recursive: true, force: true });
    }
  });
}

test("authenticated creator mutations enforce CSRF and commit ownership with rolling public quota", async () => {
  const mock = makeOpenAIMock();
  const secret = "test-session-secret-that-is-longer-than-thirty-two-characters";
  const context = await startPlatform(mock, {
    requireAuthentication: true,
    authConfiguration: {
      publicOrigin: ORIGIN,
      sessionSecret: secret,
    },
  });
  try {
    const anonymous = await postJson(
      context.baseUrl,
      "/api/v1/stories",
      createBody(),
      { Authorization: `Bearer ${TEST_KEY}` },
    );
    assert.equal(anonymous.status, 401);
    assert.equal((await anonymous.json()).error.code, "authentication_required");

    const session = seedCreatorSession(context.platform.databasePath, secret);
    const me = await fetch(`${context.baseUrl}/api/v2/auth/me`, {
      headers: { Cookie: `__Host-storyscrolls.sid=${encodeURIComponent(session.rawToken)}` },
    });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user.id, session.userId);

    const missingCsrf = await postJson(
      context.baseUrl,
      "/api/v1/estimates",
      createBody(),
      { Cookie: `__Host-storyscrolls.sid=${encodeURIComponent(session.rawToken)}` },
    );
    assert.equal(missingCsrf.status, 403);
    assert.equal((await missingCsrf.json()).error.code, "csrf_rejected");

    const first = await postJson(
      context.baseUrl,
      "/api/v1/stories",
      createBody(),
      { ...session.headers, Authorization: `Bearer ${TEST_KEY}` },
    );
    assert.equal(first.status, 201);
    const firstBody = await first.json();
    assert.equal(firstBody.story.job.status, "completed");
    const job = await fetch(`${context.baseUrl}/api/v1/jobs/${firstBody.story.job.id}`, {
      headers: { Cookie: `__Host-storyscrolls.sid=${encodeURIComponent(session.rawToken)}` },
    });
    assert.equal(job.status, 200);
    assert.equal((await job.json()).job.status, "completed");

    const second = await postJson(
      context.baseUrl,
      "/api/v1/stories",
      createBody(),
      { ...session.headers, Authorization: `Bearer ${TEST_KEY}` },
    );
    assert.equal(second.status, 429);
    assert.equal((await second.json()).error.code, "public_listing_quota_exhausted");

    const base = createBody();
    const privateCreation = await postJson(
      context.baseUrl,
      "/api/v1/stories",
      createBody({
        sharing: { visibility: "private", requestPublic: false },
        generation: {
          ...base.generation,
          illustratedContract: true,
          illustrations: { mode: "ai", density: "light" },
        },
      }),
      { ...session.headers, Authorization: `Bearer ${TEST_KEY}` },
    );
    assert.equal(privateCreation.status, 201);
    const privateResult = await privateCreation.json();
    assert.equal(privateResult.story.listing.visibility, "private");
    const anonymousPrivate = await fetch(`${context.baseUrl}/api/v1/stories/${privateResult.story.slug}`);
    assert.equal(anonymousPrivate.status, 404);
    const anonymousPrivatePage = await fetch(`${context.baseUrl}/shared/${privateResult.story.slug}/`);
    assert.equal(anonymousPrivatePage.status, 404);
    assert.doesNotMatch(await anonymousPrivatePage.text(), /Lantern Road/i);
    const anonymousPrivateReport = await postJson(
      context.baseUrl,
      "/api/v1/reports",
      { slug: privateResult.story.slug, reason: "other", details: "Existence probe" },
    );
    assert.equal(anonymousPrivateReport.status, 404);
    const ownerPrivateReport = await postJson(
      context.baseUrl,
      "/api/v1/reports",
      { slug: privateResult.story.slug, reason: "other", details: "Owner-only report" },
      session.headers,
    );
    assert.equal(ownerPrivateReport.status, 202);
    const ownerPrivate = await fetch(`${context.baseUrl}/api/v1/stories/${privateResult.story.slug}`, {
      headers: { Cookie: `__Host-storyscrolls.sid=${encodeURIComponent(session.rawToken)}` },
    });
    assert.equal(ownerPrivate.status, 200);
    const privateStory = (await ownerPrivate.json()).story;
    assert.equal(privateStory.accessLevel, "private");
    assert.ok(privateStory.assets.length >= 1);
    const privateMediaPath = privateStory.assets[0].path;
    assert.equal((await fetch(`${context.baseUrl}${privateMediaPath}`)).status, 404);
    assert.equal((await fetch(`${context.baseUrl}${privateMediaPath}`, {
      headers: { Cookie: `__Host-storyscrolls.sid=${encodeURIComponent(session.rawToken)}` },
    })).status, 200);
    const publicSearch = await fetch(`${context.baseUrl}/api/v2/community?query=lantern`).then((item) => item.json());
    assert.equal(publicSearch.total, 0);

    const db = new Database(context.platform.databasePath, { readonly: true });
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM stories").get().count, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM creator_memberships WHERE user_id = ?").get(session.userId).count, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM publication_quota_events WHERE user_id = ?").get(session.userId).count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM creation_jobs WHERE status = 'failed'").get().count, 1);
    db.close();
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("public catalog search groups approved source versions and never indexes pending or private work", async () => {
  const mock = makeOpenAIMock();
  const context = await startPlatform(mock);
  const base = createBody();
  const canonicalUrl = "https://example.org/public-domain/lantern-road";
  const makeVersion = (changeDescription, requestPublic = true) => createBody({
    sharing: { visibility: requestPublic ? "public" : "unlisted", requestPublic },
    sourceMetadata: {
      sourceTitle: "The Old Lantern Road",
      originalAuthor: "Ada Example",
      canonicalUrl,
      edition: "Archive edition",
      originalLanguage: "English",
      changeDescription,
    },
    generation: {
      ...base.generation,
      qualityLevel: 0,
      transformation: {
        mode: "faithful",
        summaryLevel: "balanced",
        modernization: "full",
      },
      audience: { targetAge: 9, format: "prose" },
    },
  });
  try {
    const created = [];
    for (const description of [
      "Modern-language edition for younger independent readers.",
      "A second illuminated modern-language edition.",
      "Pending edition that must never appear in search.",
    ]) {
      const response = await postJson(
        context.baseUrl,
        "/api/v1/stories",
        makeVersion(description),
        { Authorization: `Bearer ${TEST_KEY}` },
      );
      assert.equal(response.status, 201);
      created.push((await response.json()).story);
    }
    const unlistedResponse = await postJson(
      context.baseUrl,
      "/api/v1/stories",
      makeVersion("Unlisted link edition that must never appear in search.", false),
      { Authorization: `Bearer ${TEST_KEY}` },
    );
    assert.equal(unlistedResponse.status, 201);
    created.push((await unlistedResponse.json()).story);
    assert.equal(context.platform.setListingStatus(created[0].slug, "approved"), true);
    assert.equal(context.platform.setListingStatus(created[1].slug, "approved"), true);

    const firstPage = await fetch(`${context.baseUrl}/api/v2/community?query=ada&ageBand=middle-grade-younger&format=prose&transformation=modernization&quality=sketch&page=1&limit=1`).then((item) => item.json());
    assert.equal(firstPage.total, 2);
    assert.equal(firstPage.items.length, 1);
    assert.equal(firstPage.totalPages, 2);
    assert.equal(firstPage.items[0].originalAuthor, "Ada Example");
    assert.equal(firstPage.items[0].qualityProfile, "sketch");
    assert.equal(firstPage.items[0].languageCode, "english");
    assert.equal(firstPage.items[0].transformationType, "modernization");
    assert.equal(firstPage.items[0].illustrationRichness, "none");

    const secondPage = await fetch(`${context.baseUrl}/api/v2/community?query=lantern&page=2&limit=1`).then((item) => item.json());
    assert.equal(secondPage.total, 2);
    assert.equal(secondPage.items.length, 1);
    assert.notEqual(secondPage.items[0].slug, firstPage.items[0].slug);

    const versions = await fetch(`${context.baseUrl}/api/v2/source-versions?canonicalUrl=${encodeURIComponent(canonicalUrl)}`).then((item) => item.json());
    assert.equal(versions.matches.length, 2);
    assert.equal(new Set(versions.matches.map((item) => item.sourceFamilyKey)).size, 1);
    assert.ok(versions.matches.every((item) => item.sourceFamilyKey.match(/^source:[a-f0-9]{64}$/)));
    assert.ok(versions.matches.every((item) => item.changes && item.transformation));
    assert.ok(versions.matches.every((item) => !JSON.stringify(item).includes("gentle fantasy journey")));

    const sitemap = await fetch(`${context.baseUrl}/api/v2/community/sitemap`).then((item) => item.json());
    assert.equal(sitemap.urls.length, 2);
    assert.ok(sitemap.urls.every((entry) => !entry.url.includes(created[2].slug) && !entry.url.includes(created[3].slug)));

    const publicPageResponse = await fetch(`${context.baseUrl}/shared/${created[0].slug}/`);
    assert.equal(publicPageResponse.status, 200);
    assert.equal(publicPageResponse.headers.get("x-robots-tag"), "index, follow");
    const publicPage = await publicPageResponse.text();
    assert.match(publicPage, /<meta name="robots" content="index, follow"\/>/);
    assert.doesNotMatch(publicPage, /noindex/i);
    assert.match(publicPage, new RegExp(`<link rel="canonical" href="https://thestoryscrolls\\.com/shared/${created[0].slug}/"/>`));
    assert.match(publicPage, /application\/ld\+json/);
    assert.match(publicPage, /The Old Lantern Road/);
    assert.match(publicPage, /Scroll created by Test Author/);

    const unlistedPageResponse = await fetch(`${context.baseUrl}/shared/${created[3].slug}/`);
    assert.equal(unlistedPageResponse.status, 200);
    assert.equal(unlistedPageResponse.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.match(await unlistedPageResponse.text(), /<meta name="robots" content="noindex, nofollow"\/>/);

    const xmlResponse = await fetch(`${context.baseUrl}/community-sitemap.xml`);
    assert.equal(xmlResponse.status, 200);
    assert.match(xmlResponse.headers.get("content-type"), /^application\/xml/);
    const xml = await xmlResponse.text();
    assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
    assert.match(xml, new RegExp(`https://thestoryscrolls\\.com/shared/${created[0].slug}/`));
    assert.doesNotMatch(xml, new RegExp(`${created[2].slug}|${created[3].slug}`));
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("invalid create payloads are rejected before consuming the generation rate limit", async () => {
  const mock = makeOpenAIMock();
  const context = await startPlatform(mock, { createLimit: 1, globalCreateLimit: 10 });
  const headers = { Authorization: `Bearer ${TEST_KEY}` };
  try {
    const invalid = await postJson(
      context.baseUrl,
      "/api/v1/stories",
      createBody({ creativeBrief: "too short" }),
      headers,
    );
    assert.equal(invalid.status, 400);
    assert.equal(mock.calls.length, 0);

    for (const visualStyle of [
      "Hayao Miyazaki-inspired watercolor",
      "the aesthetic of Hayao Miyazaki",
      "as illustrated by Hayao Miyazaki",
      "evoking the visual style of Hayao Miyazaki",
    ]) {
      const artistImitation = await postJson(
        context.baseUrl,
        "/api/v1/stories",
        createBody({
          generation: {
            ...createBody().generation,
            visualStyle,
          },
        }),
        headers,
      );
      assert.equal(artistImitation.status, 400, visualStyle);
      assert.equal((await artistImitation.json()).error.code, "NAMED_ARTIST_STYLE_NOT_SUPPORTED");
      assert.equal(mock.calls.length, 0);
    }

    const accepted = await postJson(context.baseUrl, "/api/v1/stories", createBody(), headers);
    assert.equal(accepted.status, 201);

    const limited = await postJson(context.baseUrl, "/api/v1/stories", createBody(), headers);
    assert.equal(limited.status, 429);
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("summary, audience, and explicit image-budget combinations are validated before OpenAI calls", async () => {
  const mock = makeOpenAIMock();
  const context = await startPlatform(mock);
  const headers = { Authorization: `Bearer ${TEST_KEY}` };
  const base = createBody();
  try {
    const invalidBodies = [
      createBody({
        sourceText: "",
        generation: {
          ...base.generation,
          transformation: { mode: "summary", summaryLevel: "brief" },
          audience: { targetAge: 8, format: "prose" },
        },
      }),
      createBody({
        generation: {
          ...base.generation,
          transformation: { mode: "faithful", summaryLevel: "balanced" },
          audience: { targetAge: 4, format: "picture_book" },
          illustrations: { mode: "none" },
        },
      }),
      createBody({
        generation: {
          ...base.generation,
          targetChapters: 3,
          transformation: { mode: "faithful", summaryLevel: "balanced" },
          audience: { targetAge: 9, format: "prose" },
          illustrations: {
            mode: "ai",
            budget: { mode: "total", count: 2, flexibleAllocation: true },
          },
        },
      }),
      createBody({
        generation: {
          ...base.generation,
          transformation: { mode: "faithful", summaryLevel: "balanced" },
          audience: { targetAge: 9, format: "prose" },
          illustrations: {
            mode: "ai",
            budget: { mode: "per_chapter", count: 2, flexibleAllocation: true },
          },
        },
      }),
      createBody({
        sourceText: "A".repeat(240_001),
        generation: {
          ...base.generation,
          transformation: { mode: "faithful", summaryLevel: "detailed" },
          audience: { targetAge: null, format: "prose" },
        },
      }),
    ];
    for (const body of invalidBodies) {
      const response = await postJson(context.baseUrl, "/api/v1/stories", body, headers);
      assert.equal(response.status, 400);
    }
    assert.equal(mock.calls.length, 0);
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("long summary sources are hierarchically condensed in bounded calls and retain adaptation metadata", async () => {
  const mock = makeOpenAIMock();
  const context = await startPlatform(mock);
  const sourceText = "A cause, consequence, character choice, and unresolved promise. ".repeat(8_200);
  assert.ok(sourceText.length > 480_000);
  try {
    const base = createBody();
    const response = await postJson(
      context.baseUrl,
      "/api/v1/stories",
      createBody({
        sourceText,
        generation: {
          ...base.generation,
          transformation: { mode: "summary", summaryLevel: "brief" },
          audience: { targetAge: 8, format: "prose" },
          illustrations: { mode: "none" },
        },
      }),
      { Authorization: `Bearer ${TEST_KEY}` },
    );
    assert.equal(response.status, 201);
    const created = await response.json();
    const expectedDigestCount = Math.ceil(sourceText.length / 150_000);
    assert.equal(created.story.adaptation.transformation.mode, "summary");
    assert.equal(created.story.adaptation.transformation.summaryLevel, "brief");
    assert.deepEqual(created.story.adaptation.audience, { targetAge: 8, format: "prose" });
    assert.equal(created.story.adaptation.textRequestCount, expectedDigestCount + 2);
    assert.equal(created.story.adaptation.sourceCharacterCount, sourceText.trim().length);
    assert.equal(created.story.estimateInputs.textRequestCount, expectedDigestCount + 2);

    const responseCalls = mock.calls.filter(({ url }) => url.endsWith("/responses"));
    assert.equal(responseCalls.length, expectedDigestCount + 2);
    assert.equal(
      responseCalls.filter(({ body }) => body.text.format.name === "storybook_scrolls_source_digest").length,
      expectedDigestCount,
    );
    const finalCall = responseCalls.find(({ body }) => body.text.format.name === "storybook_scrolls_story");
    const finalPayload = JSON.parse(finalCall.body.input[1].content);
    assert.equal(finalPayload.source_material_kind, "ordered_loss_resistant_digest");
    assert.equal(finalPayload.source_material.sections.length, expectedDigestCount);
    assert.deepEqual(finalPayload.transformation, { mode: "summary", summaryLevel: "brief" });
    assert.match(finalCall.body.input[0].content, /condensed, flowing story-digest retelling/);
    assert.match(finalCall.body.input[0].content, /complete causal spine/);
    const ageAudit = responseCalls.find(({ body }) => body.text.format.name === "storybook_scrolls_age_suitability_audit");
    assert.match(ageAudit.body.input[0].content, /cutting off an animal's head/);

    const textModerationCalls = mock.calls.filter(
      ({ url, body }) =>
        url.endsWith("/moderations")
        && Array.isArray(body.input)
        && body.input.every((item) => typeof item === "string"),
    );
    assert.equal(textModerationCalls.length, 3);
    assert.ok(textModerationCalls.every(({ body }) => body.input.length <= 24));

    const { story } = await fetch(
      `${context.baseUrl}/api/v1/stories/${created.story.slug}`,
    ).then((item) => item.json());
    assert.deepEqual(story.adaptation, created.story.adaptation);
    assert.equal(story.illustrationPolicy.sourceCondensation.hierarchical, true);
    assert.equal(story.illustrationPolicy.sourceCondensation.digestCount, expectedDigestCount);
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("picture-book adaptation persists an image-only chapter body with a flexible total budget", async () => {
  const mock = makeOpenAIMock();
  const context = await startPlatform(mock);
  try {
    const base = createBody();
    const response = await postJson(
      context.baseUrl,
      "/api/v1/stories",
      createBody({
        generation: {
          ...base.generation,
          targetChapters: 2,
          transformation: { mode: "faithful", summaryLevel: "balanced" },
          audience: { targetAge: 3, format: "picture_book" },
          illustrations: {
            mode: "ai",
            budget: { mode: "total", count: 5, flexibleAllocation: true },
          },
        },
      }),
      { Authorization: `Bearer ${TEST_KEY}` },
    );
    assert.equal(response.status, 201);
    const created = await response.json();
    assert.deepEqual(created.story.illustrations, {
      mode: "ai",
      count: 5,
      heroes: 2,
      inline: 3,
    });
    assert.deepEqual(created.story.adaptation.audience, {
      targetAge: 3,
      format: "picture_book",
    });

    const finalCall = mock.calls.find(
      ({ url, body }) =>
        url.endsWith("/responses")
        && body.text.format.name === "storybook_scrolls_story",
    );
    const finalPayload = JSON.parse(finalCall.body.input[1].content);
    assert.deepEqual(finalPayload.interior_illustrations.budget, {
      mode: "total",
      count: 5,
      flexibleAllocation: true,
    });
    assert.equal(finalPayload.interior_illustrations.chapter_heroes, 2);
    assert.equal(finalPayload.interior_illustrations.inline_count, 3);
    assert.equal(finalPayload.interior_illustrations.inline_per_chapter, null);
    assert.match(finalCall.body.input[0].content, /stored chapter body will be image-only/);
    assert.match(finalCall.body.input[0].content, /Allocate them unevenly according to narrative density/);

    const { story } = await fetch(
      `${context.baseUrl}/api/v1/stories/${created.story.slug}`,
    ).then((item) => item.json());
    assert.ok(story.chapters.every((chapter) => chapter.blocks.length >= 1));
    assert.ok(
      story.chapters.every((chapter) => chapter.blocks.every((block) => block.kind === "image")),
    );
    assert.deepEqual(story.illustrationPolicy.budget, {
      mode: "total",
      count: 5,
      flexibleAllocation: true,
    });
    assert.equal(story.assets.length, 5);
    assert.ok(story.assets.every((asset) => typeof asset.alt === "string" && asset.alt.length > 0));
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("a non-flexible total image budget rejects clustered model placement", async () => {
  const mock = makeOpenAIMock({
    storyFactory: (chapters, heroes, inlinePerChapter, illustrationRequest) => {
      const story = mockStory(chapters, heroes, inlinePerChapter, illustrationRequest);
      for (const illustration of story.inline_illustrations) illustration.chapter_number = 1;
      return story;
    },
  });
  const context = await startPlatform(mock);
  try {
    const base = createBody();
    const response = await postJson(
      context.baseUrl,
      "/api/v1/stories",
      createBody({
        generation: {
          ...base.generation,
          targetChapters: 3,
          transformation: { mode: "faithful", summaryLevel: "balanced" },
          audience: { targetAge: null, format: "prose" },
          illustrations: {
            mode: "ai",
            budget: { mode: "total", count: 8, flexibleAllocation: false },
          },
        },
      }),
      { Authorization: `Bearer ${TEST_KEY}` },
    );
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, "INVALID_MODEL_OUTPUT");
    assert.equal(mock.imageCalls, 0);
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("identical duplicate character-roster rows collapse to one canonical image instruction", async () => {
  const mock = makeOpenAIMock({
    storyFactory: (chapters, heroes, inlinePerChapter, illustrationRequest) => {
      const story = mockStory(chapters, heroes, inlinePerChapter, illustrationRequest);
      story.cover.character_roster.push({
        name: "  THE MAPMAKER  ",
        count: 1,
        duplicate_justification: " \r\n ",
      });
      return story;
    },
  });
  const context = await startPlatform(mock);
  try {
    const base = createBody();
    const response = await postJson(
      context.baseUrl,
      "/api/v1/stories",
      createBody({
        generation: {
          ...base.generation,
          illustratedContract: true,
          illustrations: { mode: "ai", density: "light" },
        },
      }),
      { Authorization: `Bearer ${TEST_KEY}` },
    );
    assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
    const coverEdit = mock.calls.find(
      ({ url, body }) => url.endsWith("/edits") && body.size === "1024x1536",
    );
    assert.ok(coverEdit);
    assert.equal(
      coverEdit.body.prompt.match(/The mapmaker: exactly 1 visual instance/g)?.length,
      1,
    );
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("scene-local named characters outside the continuity sheet keep an exact bounded image count", async () => {
  const mock = makeOpenAIMock({
    storyFactory: (chapters, heroes, inlinePerChapter, illustrationRequest) => {
      const story = mockStory(chapters, heroes, inlinePerChapter, illustrationRequest);
      story.cover.character_roster.push({
        name: "The lamplighter",
        count: 1,
        duplicate_justification: "",
      });
      return story;
    },
  });
  const context = await startPlatform(mock);
  try {
    const base = createBody();
    const response = await postJson(
      context.baseUrl,
      "/api/v1/stories",
      createBody({
        generation: {
          ...base.generation,
          illustratedContract: true,
          illustrations: { mode: "ai", density: "light" },
        },
      }),
      { Authorization: `Bearer ${TEST_KEY}` },
    );
    assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
    const coverEdit = mock.calls.find(
      ({ url, body }) => url.endsWith("/edits") && body.size === "1024x1536",
    );
    assert.ok(coverEdit);
    assert.match(coverEdit.body.prompt, /The lamplighter: exactly 1 visual instance/);
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("conflicting duplicate character-roster rows remain a hard validation failure", async () => {
  const mock = makeOpenAIMock({
    storyFactory: (chapters, heroes, inlinePerChapter, illustrationRequest) => {
      const story = mockStory(chapters, heroes, inlinePerChapter, illustrationRequest);
      story.cover.character_roster.push({
        name: "the mapmaker",
        count: 2,
        duplicate_justification: "A literal magical double appears beside the traveler.",
      });
      return story;
    },
  });
  const context = await startPlatform(mock);
  try {
    const base = createBody();
    const response = await postJson(
      context.baseUrl,
      "/api/v1/stories",
      createBody({
        generation: {
          ...base.generation,
          illustratedContract: true,
          illustrations: { mode: "ai", density: "light" },
        },
      }),
      { Authorization: `Bearer ${TEST_KEY}` },
    );
    assert.equal(response.status, 502);
    const payload = await response.json();
    assert.equal(payload.error.code, "INVALID_MODEL_OUTPUT");
    assert.match(payload.error.message, /conflicting entries/);
    assert.equal(mock.imageCalls, 0);
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("large stories and image plans receive a bounded dynamic structured-output budget", async () => {
  const mock = makeOpenAIMock({
    storyFactory: () => mockStory(1),
  });
  const context = await startPlatform(mock);
  try {
    const base = createBody();
    const response = await postJson(
      context.baseUrl,
      "/api/v1/stories",
      createBody({
        generation: {
          ...base.generation,
          targetChapters: 24,
          targetWordsPerChapter: 2_000,
          transformation: { mode: "faithful", summaryLevel: "balanced" },
          audience: { targetAge: null, format: "prose" },
          illustrations: {
            mode: "ai",
            budget: { mode: "total", count: 120, flexibleAllocation: true },
          },
        },
      }),
      { Authorization: `Bearer ${TEST_KEY}` },
    );
    assert.equal(response.status, 502);
    const responseCall = mock.calls.find(({ url }) => url.endsWith("/responses"));
    assert.equal(responseCall.body.max_output_tokens, 120_000);
    assert.equal(mock.imageCalls, 0);
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("new creator scrolls reject text-only mode and never persist the BYOK key", async () => {
  const mock = makeOpenAIMock();
  const context = await startPlatform(mock, { allowLegacyTextOnly: false });
  try {
    const response = await postJson(context.baseUrl, "/api/v1/stories", createBody(), {
      Authorization: `Bearer ${TEST_KEY}`,
      "X-Storyscrolls-Session": "test-session-0123456789",
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "ILLUSTRATIONS_REQUIRED");
    assert.equal(mock.imageCalls, 0);
    assert.equal(mock.calls.length, 0);
  } finally {
    await context.platform.close();
  }

  try {
    const persisted = readAllFiles(context.dataDir);
    for (const bytes of persisted) {
      assert.equal(bytes.includes(Buffer.from(TEST_KEY)), false);
    }
    assert.equal(JSON.stringify(context.logs).includes(TEST_KEY), false);
    assert.equal(JSON.stringify(mock.calls).includes(TEST_KEY), false);
    assert.deepEqual(await fsp.readdir(path.join(context.dataDir, "media")), []);
  } finally {
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("light AI mode creates one referenced supported landscape hero per chapter and no inline scenes", async () => {
  const mock = makeOpenAIMock();
  const context = await startPlatform(mock);
  try {
    const body = createBody({
      generation: {
        ...createBody().generation,
        targetChapters: 2,
        targetWordsPerChapter: 1_600,
        outputSize: "web",
        illustrations: { mode: "ai", density: "light" },
      },
    });
    const response = await postJson(context.baseUrl, "/api/v1/stories", body, {
      Authorization: `Bearer ${TEST_KEY}`,
    });
    assert.equal(response.status, 201);
    const created = await response.json();
    assert.deepEqual(created.story.illustrations, {
      mode: "ai",
      count: 2,
      heroes: 2,
      inline: 0,
    });
    assert.equal(mock.referenceCalls, 1);
    assert.equal(mock.editCalls, 2);
    assert.equal(mock.imageCalls, 3);
    const aiImageRequests = mock.calls.filter(
      ({ url }) => url.endsWith("/images/generations") || url.endsWith("/images/edits"),
    );
    assert.equal(aiImageRequests.length, 3);
    assert.ok(aiImageRequests.every(({ body }) => body.moderation === "auto"));
    assert.equal(
      mock.calls.filter(
        ({ url, body }) =>
          url.endsWith("/moderations")
          && Array.isArray(body.input)
          && body.input.some((item) => item?.type === "image_url"),
      ).length,
      0,
      "provider-generated bytes are not redundantly resubmitted to multimodal moderation",
    );
    const responseCall = mock.calls.find(({ url }) => url.endsWith("/responses"));
    const requested = JSON.parse(responseCall.body.input[1].content).interior_illustrations;
    assert.deepEqual(
      {
        chapterHeroes: requested.chapter_heroes,
        inlineCount: requested.inline_count,
        inlinePerChapter: requested.inline_per_chapter,
      },
      { chapterHeroes: 2, inlineCount: 0, inlinePerChapter: 0 },
    );
    assert.equal(responseCall.body.text.format.schema.properties.chapter_heroes.minItems, 2);
    assert.equal(responseCall.body.text.format.schema.properties.chapter_heroes.maxItems, 2);
    assert.equal(responseCall.body.text.format.schema.properties.inline_illustrations.minItems, 0);
    assert.equal(responseCall.body.text.format.schema.properties.inline_illustrations.maxItems, 0);
    const editSizes = mock.calls
      .filter(({ url }) => url.endsWith("/edits"))
      .map(({ body: edit }) => edit.size);
    assert.deepEqual(editSizes, ["1536x1024", "1536x1024"]);

    const { story } = await fetch(
      `${context.baseUrl}/api/v1/stories/${created.story.slug}`,
    ).then((item) => item.json());
    assert.equal(story.assets.length, 2);
    assert.ok(story.assets.every((asset) => asset.type === "ai-illustration"));
    assert.ok(story.assets.every((asset) => asset.creator === "OpenAI GPT Image 2"));
    assert.ok(story.assets.every((asset) => asset.placement === "chapter-hero"));
    assert.ok(story.assets.every((asset) => asset.width === 1_024 && asset.height === 683));
    for (const chapter of story.chapters) {
      assert.deepEqual(chapter.blocks[0], {
        kind: "image",
        assetId: chapter.blocks[0].assetId,
        placement: "chapter-hero",
        align: "hero",
      });
      assert.equal(chapter.blocks.filter((block) => block.kind === "image").length, 1);
    }
    assert.equal(story.illustrationPolicy.model, "gpt-image-2");
    assert.equal(story.illustrationPolicy.quality, "low");
    assert.equal(story.illustrationPolicy.heroCount, 2);
    assert.equal(story.illustrationPolicy.inlineCount, 0);
    assert.equal(story.illustrationPolicy.continuityReferenceStored, false);
    assert.deepEqual(story.illustrationPolicy.generationSafety, {
      provider: "OpenAI",
      endpoint: "images",
      mechanism: "provider_generation_moderation",
      mode: "auto",
      policy: "Each generated image request is moderated by the Images API; moderation-blocked outputs fail the atomic creation job.",
    });
    const db = new Database(context.platform.databasePath, { readonly: true });
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM story_assets").get().count, 2);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM story_assets WHERE placement_kind = 'chapter-hero'").get().count,
      2,
    );
    const moderationSummary = JSON.parse(
      db.prepare("SELECT moderation_json FROM stories LIMIT 1").get().moderation_json,
    );
    assert.equal(moderationSummary.images.decision, null);
    assert.equal(moderationSummary.images.scores, null);
    assert.equal(moderationSummary.images.mechanism, "provider_generation_moderation");
    assert.equal(moderationSummary.images.mode, "auto");
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM moderation_events WHERE stage = 'image_output'").get().count,
      0,
    );
    db.close();
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("referenced image edits use OpenAI's exact singular multipart image field", async () => {
  const mock = makeOpenAIMock();
  const context = await startPlatform(mock);
  try {
    const base = createBody();
    const response = await postJson(
      context.baseUrl,
      "/api/v1/stories",
      createBody({
        generation: {
          ...base.generation,
          illustrations: { mode: "ai", density: "light" },
        },
      }),
      { Authorization: `Bearer ${TEST_KEY}` },
    );
    assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
    const edits = mock.calls.filter(({ url }) => url.endsWith("/images/edits"));
    assert.equal(edits.length, 1);
    assert.deepEqual(edits[0].imageFieldNames, ["image"]);
    assert.equal(edits[0].references, 1);
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("image edits retry 429 and 5xx twice with fresh multipart bodies and safe diagnostics", async () => {
  const upstream = makeOpenAIMock();
  const forms = [];
  let editAttempts = 0;
  const privateProviderMessage = `do not log this prompt or ${TEST_KEY}`;
  const mock = {
    fetchImpl: async (url, options) => {
      if (url.endsWith("/images/edits")) {
        editAttempts += 1;
        forms.push(options.body);
        if (editAttempts <= 2) {
          const status = editAttempts === 1 ? 429 : 503;
          return new Response(JSON.stringify({
            error: {
              code: editAttempts === 1 ? "rate_limit_exceeded" : "server_error",
              type: editAttempts === 1 ? "rate_limit_error" : "server_error",
              message: privateProviderMessage,
            },
          }), {
            status,
            headers: {
              "content-type": "application/json",
              "x-request-id": `req_image_retry_${editAttempts}`,
            },
          });
        }
      }
      return upstream.fetchImpl(url, options);
    },
  };
  const context = await startPlatform(mock);
  try {
    const base = createBody();
    const response = await postJson(
      context.baseUrl,
      "/api/v1/stories",
      createBody({
        generation: {
          ...base.generation,
          illustrations: { mode: "ai", density: "light" },
        },
      }),
      { Authorization: `Bearer ${TEST_KEY}` },
    );
    assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
    assert.equal(editAttempts, 3);
    assert.notEqual(forms[0], forms[1]);
    assert.notEqual(forms[1], forms[2]);
    assert.ok(forms.every((form) => form.getAll("image").length === 1));
    assert.ok(forms.every((form) => form.has("image[]") === false));
    const diagnostics = context.logs.filter(([event]) => event === "openai provider failure");
    assert.deepEqual(diagnostics, [
      ["openai provider failure", {
        endpointClass: "images",
        status: 429,
        requestId: "req_image_retry_1",
        errorCode: "rate_limit_exceeded",
        errorType: "rate_limit_error",
      }],
      ["openai provider failure", {
        endpointClass: "images",
        status: 503,
        requestId: "req_image_retry_2",
        errorCode: "server_error",
        errorType: "server_error",
      }],
    ]);
    const serializedLogs = JSON.stringify(context.logs);
    assert.equal(serializedLogs.includes(privateProviderMessage), false);
    assert.equal(serializedLogs.includes(TEST_KEY), false);
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("image edits retry an HTTP 200 unreadable response and log only safe diagnostics", async () => {
  const upstream = makeOpenAIMock();
  const forms = [];
  let editAttempts = 0;
  const privateProviderPayload = `not-json:${TEST_KEY}:private image response`;
  const mock = {
    fetchImpl: async (url, options) => {
      if (url.endsWith("/images/edits")) {
        editAttempts += 1;
        forms.push(options.body);
        if (editAttempts === 1) {
          return new Response(privateProviderPayload, {
            status: 200,
            headers: {
              "content-type": "application/json",
              "x-request-id": "req_image_unreadable_1",
            },
          });
        }
      }
      return upstream.fetchImpl(url, options);
    },
  };
  const context = await startPlatform(mock);
  try {
    const base = createBody();
    const response = await postJson(
      context.baseUrl,
      "/api/v1/stories",
      createBody({
        generation: {
          ...base.generation,
          illustrations: { mode: "ai", density: "light" },
        },
      }),
      { Authorization: `Bearer ${TEST_KEY}` },
    );
    assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
    assert.equal(editAttempts, 2);
    assert.notEqual(forms[0], forms[1]);
    assert.ok(forms.every((form) => form.getAll("image").length === 1));
    assert.ok(forms.every((form) => form.has("image[]") === false));
    assert.deepEqual(
      context.logs.filter(([event]) => event === "openai provider failure"),
      [["openai provider failure", {
        endpointClass: "images",
        status: 200,
        requestId: "req_image_unreadable_1",
        errorCode: "unreadable_response",
        errorType: "provider_response_parse_error",
      }]],
    );
    const serializedLogs = JSON.stringify(context.logs);
    assert.equal(serializedLogs.includes(privateProviderPayload), false);
    assert.equal(serializedLogs.includes(TEST_KEY), false);
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("image edits never retry a non-rate-limit 4xx provider rejection", async () => {
  const upstream = makeOpenAIMock();
  let editAttempts = 0;
  const mock = {
    fetchImpl: async (url, options) => {
      if (url.endsWith("/images/edits")) {
        editAttempts += 1;
        return new Response(JSON.stringify({
          error: {
            code: "invalid_image",
            type: "invalid_request_error",
            message: `must stay private ${TEST_KEY}`,
          },
        }), {
          status: 400,
          headers: {
            "content-type": "application/json",
            "x-request-id": "req_image_bad_request",
          },
        });
      }
      return upstream.fetchImpl(url, options);
    },
  };
  const context = await startPlatform(mock);
  try {
    const base = createBody();
    const response = await postJson(
      context.baseUrl,
      "/api/v1/stories",
      createBody({
        generation: {
          ...base.generation,
          illustrations: { mode: "ai", density: "light" },
        },
      }),
      { Authorization: `Bearer ${TEST_KEY}` },
    );
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error.code, "IMAGE_GENERATION_FAILED");
    assert.equal(editAttempts, 1);
    const diagnostics = context.logs.filter(([event]) => event === "openai provider failure");
    assert.deepEqual(diagnostics, [["openai provider failure", {
      endpointClass: "images",
      status: 400,
      requestId: "req_image_bad_request",
      errorCode: "invalid_image",
      errorType: "invalid_request_error",
    }]]);
    assert.equal(JSON.stringify(context.logs).includes(TEST_KEY), false);
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("image moderation blocks return redacted, actionable guidance without a paid retry", async () => {
  const upstream = makeOpenAIMock();
  let editAttempts = 0;
  const privateProviderMessage = `must stay private ${TEST_KEY}`;
  const mock = {
    fetchImpl: async (url, options) => {
      if (url.endsWith("/images/edits")) {
        editAttempts += 1;
        return new Response(JSON.stringify({
          error: {
            code: "moderation_blocked",
            type: "invalid_request_error",
            message: privateProviderMessage,
          },
        }), {
          status: 400,
          headers: {
            "content-type": "application/json",
            "x-request-id": "req_image_moderation_blocked",
          },
        });
      }
      return upstream.fetchImpl(url, options);
    },
  };
  const context = await startPlatform(mock, { asyncCreates: true });
  try {
    const base = createBody();
    const accepted = await postJson(
      context.baseUrl,
      "/api/v1/stories",
      createBody({
        generation: {
          ...base.generation,
          illustrations: { mode: "ai", density: "light" },
        },
      }),
      {
        Authorization: `Bearer ${TEST_KEY}`,
        "Idempotency-Key": crypto.randomUUID(),
      },
    );
    assert.equal(accepted.status, 202);
    const { job } = await accepted.json();
    const failed = await waitForCreationJob(context.baseUrl, job.id);

    assert.equal(failed.job.status, "failed");
    assert.equal(failed.job.error.code, "IMAGE_SAFETY_REVISION_REQUIRED");
    assert.match(failed.job.error.message, /not a judgment about your story/i);
    assert.match(failed.job.error.message, /prepare and approve a new visual guide/i);
    assert.match(failed.job.error.message, /no automatic retry was made/i);
    assert.equal(editAttempts, 1);
    assert.deepEqual(
      context.logs.filter(([event]) => event === "openai provider failure"),
      [["openai provider failure", {
        endpointClass: "images",
        status: 400,
        requestId: "req_image_moderation_blocked",
        errorCode: "moderation_blocked",
        errorType: "invalid_request_error",
      }]],
    );
    const serialized = JSON.stringify({ failed, logs: context.logs });
    assert.equal(serialized.includes(privateProviderMessage), false);
    assert.equal(serialized.includes(TEST_KEY), false);
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("AI illustration rendering runs at no more than two concurrent image edits", async () => {
  const upstream = makeOpenAIMock();
  let activeEdits = 0;
  let maximumActiveEdits = 0;
  const mock = {
    fetchImpl: async (url, options) => {
      if (!url.endsWith("/images/edits")) return upstream.fetchImpl(url, options);
      activeEdits += 1;
      maximumActiveEdits = Math.max(maximumActiveEdits, activeEdits);
      try {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return await upstream.fetchImpl(url, options);
      } finally {
        activeEdits -= 1;
      }
    },
  };
  const context = await startPlatform(mock);
  try {
    const base = createBody();
    const response = await postJson(
      context.baseUrl,
      "/api/v1/stories",
      createBody({
        generation: {
          ...base.generation,
          targetChapters: 2,
          illustratedContract: true,
          illustrations: { mode: "ai", density: "light" },
        },
      }),
      { Authorization: `Bearer ${TEST_KEY}` },
    );
    assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
    assert.equal(upstream.editCalls, 5);
    assert.equal(maximumActiveEdits, 2);
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("balanced AI mode creates one hero and one anchored inline illustration per chapter", async () => {
  const mock = makeOpenAIMock();
  const context = await startPlatform(mock);
  try {
    const base = createBody();
    const response = await postJson(
      context.baseUrl,
      "/api/v1/stories",
      createBody({
        generation: {
          ...base.generation,
          targetChapters: 3,
          targetWordsPerChapter: 1_900,
          illustrations: { mode: "ai", density: "balanced" },
        },
      }),
      { Authorization: `Bearer ${TEST_KEY}` },
    );
    assert.equal(response.status, 201);
    const created = await response.json();
    assert.deepEqual(created.story.illustrations, {
      mode: "ai",
      count: 6,
      heroes: 3,
      inline: 3,
    });
    assert.equal(mock.referenceCalls, 1);
    assert.equal(mock.editCalls, 6);
    const edits = mock.calls.filter(({ url }) => url.endsWith("/edits"));
    assert.deepEqual(
      edits.map(({ body }) => body.size),
      ["1536x1024", "1536x1024", "1536x1024", "1024x1536", "1024x1536", "1024x1536"],
    );
    assert.ok(edits.every(({ references }) => references === 1));

    const responseCall = mock.calls.find(({ url }) => url.endsWith("/responses"));
    assert.equal(responseCall.body.text.format.schema.properties.chapter_heroes.minItems, 3);
    assert.equal(responseCall.body.text.format.schema.properties.inline_illustrations.minItems, 3);
    assert.match(responseCall.body.input[0].content, /exactly 1 per chapter/);
    assert.match(
      responseCall.body.text.format.schema.properties.inline_illustrations.items.properties
        .after_block_index.description,
      /0 means immediately after the first prose block/,
    );

    const { story } = await fetch(
      `${context.baseUrl}/api/v1/stories/${created.story.slug}`,
    ).then((item) => item.json());
    for (const chapter of story.chapters) {
      assert.equal(chapter.blocks[0].placement, "chapter-hero");
      assert.equal(chapter.blocks[0].align, "hero");
      const inline = chapter.blocks.filter(
        (block) => block.kind === "image" && block.placement === "inline",
      );
      assert.equal(inline.length, 1);
    }
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("rich AI mode derives and caps inline density at three scenes per chapter", async () => {
  const mock = makeOpenAIMock();
  const context = await startPlatform(mock);
  try {
    const base = createBody();
    const response = await postJson(
      context.baseUrl,
      "/api/v1/stories",
      createBody({
        generation: {
          ...base.generation,
          targetChapters: 2,
          targetWordsPerChapter: 2_000,
          illustrations: { mode: "ai", density: "rich" },
        },
      }),
      { Authorization: `Bearer ${TEST_KEY}` },
    );
    assert.equal(response.status, 201);
    const created = await response.json();
    assert.deepEqual(created.story.illustrations, {
      mode: "ai",
      count: 8,
      heroes: 2,
      inline: 6,
    });
    assert.equal(mock.referenceCalls, 1);
    assert.equal(mock.editCalls, 8);
    assert.equal(mock.imageCalls, 9);
    const responseCall = mock.calls.find(({ url }) => url.endsWith("/responses"));
    const requested = JSON.parse(responseCall.body.input[1].content).interior_illustrations;
    assert.equal(requested.inline_per_chapter, 3);
    assert.equal(responseCall.body.text.format.schema.properties.chapter_heroes.maxItems, 2);
    assert.equal(responseCall.body.text.format.schema.properties.inline_illustrations.maxItems, 6);

    const { story } = await fetch(
      `${context.baseUrl}/api/v1/stories/${created.story.slug}`,
    ).then((item) => item.json());
    for (const chapter of story.chapters) {
      assert.equal(chapter.blocks[0].placement, "chapter-hero");
      assert.equal(
        chapter.blocks.filter((block) => block.kind === "image" && block.placement !== "chapter-hero").length,
        3,
      );
    }
    assert.equal(story.illustrationPolicy.inlinePerChapter, 3);
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

for (const [label, mutatePlan] of [
  ["duplicate chapter heroes", (story) => {
    story.chapter_heroes[1].chapter_number = 1;
  }],
  ["uneven inline scenes", (story) => {
    story.inline_illustrations[1].chapter_number = 1;
  }],
]) {
  test(`rejects model output with ${label} before any image generation`, async () => {
    const mock = makeOpenAIMock({
      storyFactory: (chapters, heroes, inlinePerChapter) => {
        const story = mockStory(chapters, heroes, inlinePerChapter);
        mutatePlan(story);
        return story;
      },
    });
    const context = await startPlatform(mock);
    try {
      const base = createBody();
      const response = await postJson(
        context.baseUrl,
        "/api/v1/stories",
        createBody({
          generation: {
            ...base.generation,
            targetChapters: 2,
            illustrations: { mode: "ai", density: "balanced" },
          },
        }),
        { Authorization: `Bearer ${TEST_KEY}` },
      );
      assert.equal(response.status, 502);
      assert.equal((await response.json()).error.code, "INVALID_MODEL_OUTPUT");
      assert.equal(mock.imageCalls, 0);
      const db = new Database(context.platform.databasePath, { readonly: true });
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM stories").get().count, 0);
      db.close();
    } finally {
      await context.platform.close();
      await fsp.rm(context.dataDir, { recursive: true, force: true });
    }
  });
}

test("uploaded artwork is normalized, moderated, placed by filename, and stored under opaque names", async () => {
  const mock = makeOpenAIMock();
  const context = await startPlatform(mock);
  const first = await sharp({
    create: { width: 900, height: 700, channels: 3, background: "#9b6d43" },
  }).png().toBuffer();
  const second = await sharp({
    create: { width: 700, height: 900, channels: 3, background: "#315a70" },
  }).jpeg().toBuffer();
  try {
    const base = createBody();
    const body = createBody({
      rights: {
        ...base.rights,
        artConfirmed: true,
        artCredit: "Test Illustrator",
      },
      generation: {
        ...base.generation,
        illustrations: { mode: "upload" },
      },
    });
    const response = await postMultipart(
      context.baseUrl,
      body,
      [
        {
          name: "002__ch01-pct100-plate__the-road-beyond-the-trees.jpg",
          type: "image/jpeg",
          bytes: second,
        },
        {
          name: "001__ch01-hero__a-lantern-in-the-rain.png",
          type: "image/png",
          bytes: first,
        },
      ],
      { Authorization: `Bearer ${TEST_KEY}` },
    );
    assert.equal(response.status, 201, JSON.stringify(await response.clone().json().catch(() => null)));
    const created = await response.json();
    assert.deepEqual(created.story.illustrations, {
      mode: "upload",
      count: 2,
      heroes: 1,
      inline: 1,
    });
    assert.equal(mock.imageCalls, 0);
    assert.equal(mock.calls.filter(({ url }) => url.endsWith("/moderations")).length, 3);
    const uploadImageModeration = mock.calls.filter(
      ({ url, body }) =>
        url.endsWith("/moderations")
        && Array.isArray(body.input)
        && body.input.some((item) => item?.type === "image_url"),
    );
    assert.ok(uploadImageModeration.length >= 1);
    assert.ok(uploadImageModeration.every(({ body }) => body.input.length <= 8));
    const firstModeration = mock.calls.find(({ url }) => url.endsWith("/moderations"));
    assert.match(firstModeration.body.input.join("\n"), /Test Illustrator/);
    assert.match(firstModeration.body.input.join("\n"), /A lantern in the rain/);
    assert.match(firstModeration.body.input.join("\n"), /The road beyond the trees/);

    const { story } = await fetch(
      `${context.baseUrl}/api/v1/stories/${created.story.slug}`,
    ).then((item) => item.json());
    assert.equal(story.assets.length, 2);
    assert.ok(story.assets.every((asset) => asset.type === "illustration"));
    assert.ok(story.assets.every((asset) => asset.creator === "Test Illustrator"));
    assert.deepEqual(story.assets.map((asset) => asset.placement).sort(), ["chapter-hero", "inline"]);
    assert.deepEqual(
      story.chapters[0].blocks.filter((block) => block.kind === "image").map((block) => block.align),
      ["hero", "plate"],
    );
    assert.equal(story.chapters[0].blocks[0].placement, "chapter-hero");
    const db = new Database(context.platform.databasePath, { readonly: true });
    const rows = db.prepare("SELECT * FROM story_assets ORDER BY original_filename").all();
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.origin === "uploaded" && row.media_type === "image/webp"));
    assert.deepEqual(rows.map((row) => row.placement_kind).sort(), ["chapter-hero", "inline"]);
    assert.ok(rows.every((row) => /^illustration-[0-9a-f-]{36}\.webp$/.test(row.filename)));
    assert.ok(rows.every((row) => !row.storage_path.includes(row.original_filename)));
    db.close();
    const media = await fetch(`${context.baseUrl}${story.assets[0].path}`);
    assert.equal(media.status, 200);
    assert.equal(media.headers.get("content-type"), "image/webp");
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("uploaded artwork may omit chapter heroes but cannot define two heroes for one chapter", async () => {
  const mock = makeOpenAIMock();
  const context = await startPlatform(mock);
  const pixels = await sharp({
    create: { width: 640, height: 480, channels: 3, background: "#66513a" },
  }).png().toBuffer();
  const base = createBody();
  const uploadBody = createBody({
    rights: { ...base.rights, artConfirmed: true, artCredit: "Test Illustrator" },
    generation: {
      ...base.generation,
      targetChapters: 2,
      illustrations: { mode: "upload" },
    },
  });
  try {
    const inlineOnly = await postMultipart(
      context.baseUrl,
      uploadBody,
      [{
        name: "001__ch02-pct050-left__a-bridge-in-moonlight.png",
        type: "image/png",
        bytes: pixels,
      }],
      { Authorization: `Bearer ${TEST_KEY}` },
    );
    assert.equal(inlineOnly.status, 201);
    assert.deepEqual((await inlineOnly.json()).story.illustrations, {
      mode: "upload",
      count: 1,
      heroes: 0,
      inline: 1,
    });

    const callsBeforeDuplicate = mock.calls.length;
    const duplicateHeroes = await postMultipart(
      context.baseUrl,
      uploadBody,
      [
        {
          name: "001__ch01-hero__the-first-hero.png",
          type: "image/png",
          bytes: pixels,
        },
        {
          name: "002__ch01-hero__the-second-hero.png",
          type: "image/png",
          bytes: pixels,
        },
      ],
      { Authorization: `Bearer ${TEST_KEY}` },
    );
    assert.equal(duplicateHeroes.status, 400);
    assert.equal((await duplicateHeroes.json()).error.code, "INVALID_IMAGE_PLACEMENT");
    assert.equal(mock.calls.length, callsBeforeDuplicate);
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("invalid upload labels and oversized files are rejected before OpenAI and leave staging empty", async () => {
  const mock = makeOpenAIMock();
  const context = await startPlatform(mock);
  const base = createBody();
  const body = createBody({
    rights: { ...base.rights, artConfirmed: true, artCredit: "Test Illustrator" },
    generation: { ...base.generation, illustrations: { mode: "upload" } },
  });
  try {
    const invalid = await postMultipart(
      context.baseUrl,
      body,
      [{ name: "../../bad.png", type: "image/png", bytes: Buffer.from("not-an-image") }],
      { Authorization: `Bearer ${TEST_KEY}` },
    );
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, "INVALID_IMAGE_UPLOAD");
    assert.equal(mock.calls.length, 0);

    const oversized = await postMultipart(
      context.baseUrl,
      body,
      [{
        name: "001__ch01-pct025-right__oversized-art.png",
        type: "image/png",
        bytes: Buffer.alloc(6 * 1024 * 1024 + 1),
      }],
      { Authorization: `Bearer ${TEST_KEY}` },
    );
    assert.equal(oversized.status, 413);
    assert.equal(mock.calls.length, 0);
    assert.deepEqual(await fsp.readdir(path.join(context.dataDir, ".staging")), []);
    assert.deepEqual(await fsp.readdir(path.join(context.dataDir, "media")), []);
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("text moderation authenticates the key before uploaded pixels are decoded", async () => {
  const mock = makeOpenAIMock({ inputDecision: "reject" });
  const context = await startPlatform(mock);
  const base = createBody();
  const body = createBody({
    rights: { ...base.rights, artConfirmed: true, artCredit: "Test Illustrator" },
    generation: { ...base.generation, illustrations: { mode: "upload" } },
  });
  try {
    const response = await postMultipart(
      context.baseUrl,
      body,
      [{
        name: "001__ch01-pct025-right__deliberately-invalid-pixels.png",
        type: "image/png",
        bytes: Buffer.from("this is not an image"),
      }],
      { Authorization: `Bearer ${TEST_KEY}` },
    );
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error.code, "CONTENT_NOT_ALLOWED");
    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0].url.endsWith("/moderations"), true);
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("chunked multipart requests above the total body limit cannot crash the service", async () => {
  const mock = makeOpenAIMock();
  const context = await startPlatform(mock);
  const boundary = "StoryScrollsBoundary7MA4YWxkTrZu0gW";
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="request"\r\n\r\n{}\r\n`
      + `--${boundary}\r\nContent-Disposition: form-data; name="illustrations"; filename="001__ch01-pct025-right__test-art.png"\r\nContent-Type: image/png\r\n\r\n`,
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  let client;
  try {
    const response = await new Promise((resolve) => {
      const url = new URL(context.baseUrl);
      client = http.request(
        {
          host: url.hostname,
          port: url.port,
          path: "/api/v1/stories",
          method: "POST",
          agent: false,
          headers: {
            Origin: ORIGIN,
            Authorization: `Bearer ${TEST_KEY}`,
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
            "Transfer-Encoding": "chunked",
            Connection: "close",
          },
        },
        (incoming) => {
          const chunks = [];
          incoming.on("data", (chunk) => chunks.push(chunk));
          incoming.on("end", () =>
            resolve({
              status: incoming.statusCode,
              body: Buffer.concat(chunks).toString("utf8"),
            }));
        },
      );
      client.on("error", (error) => resolve({ requestError: error.code }));
      client.write(prefix);
      const megabyte = Buffer.alloc(1024 * 1024, 0x61);
      let sent = 0;
      const send = () => {
        while (sent < 51) {
          sent += 1;
          if (!client.write(megabyte)) {
            client.once("drain", send);
            return;
          }
        }
        client.end(suffix);
      };
      send();
    });
    client?.destroy();
    assert.equal(response.status, 413);
    assert.equal(JSON.parse(response.body).error.code, "REQUEST_TOO_LARGE");
    assert.equal(mock.calls.length, 0);
    assert.deepEqual(await fsp.readdir(path.join(context.dataDir, ".staging")), []);
    assert.deepEqual(await fsp.readdir(path.join(context.dataDir, "media")), []);
  } finally {
    client?.destroy();
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("rejects hard-blocked material before generation or image work", async () => {
  const mock = makeOpenAIMock({ inputDecision: "reject" });
  const context = await startPlatform(mock);
  try {
    const response = await postJson(context.baseUrl, "/api/v1/stories", createBody(), {
      Authorization: `Bearer ${TEST_KEY}`,
    });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error.code, "CONTENT_NOT_ALLOWED");
    assert.equal(mock.calls.length, 1);
    assert.equal(mock.imageCalls, 0);
  } finally {
    await context.platform.close();
    const db = new Database(context.platform.databasePath, { readonly: true });
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM stories").get().count, 0);
    db.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("does not commit an AI story when a required reference or scene image fails", async () => {
  const mock = makeOpenAIMock({ failImage: 2 });
  const context = await startPlatform(mock);
  try {
    const base = createBody();
    const response = await postJson(
      context.baseUrl,
      "/api/v1/stories",
      createBody({
        generation: {
          ...base.generation,
          illustrations: { mode: "ai", density: "light" },
        },
      }),
      { Authorization: `Bearer ${TEST_KEY}` },
    );
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error.code, "IMAGE_GENERATION_FAILED");
  } finally {
    await context.platform.close();
    const db = new Database(context.platform.databasePath, { readonly: true });
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM stories").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM story_assets").get().count, 0);
    db.close();
    assert.deepEqual(await fsp.readdir(path.join(context.dataDir, "media")), []);
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("enforces same-origin and bearer-key guards without calling OpenAI", async () => {
  const mock = makeOpenAIMock();
  const context = await startPlatform(mock);
  try {
    const wrongOrigin = await fetch(`${context.baseUrl}/api/v1/stories`, {
      method: "POST",
      headers: {
        Origin: "https://attacker.invalid",
        Authorization: `Bearer ${TEST_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(createBody()),
    });
    assert.equal(wrongOrigin.status, 403);
    const missingKey = await postJson(context.baseUrl, "/api/v1/stories", createBody());
    assert.equal(missingKey.status, 401);
    assert.equal((await missingKey.json()).error.code, "OPENAI_KEY_REQUIRED");
    assert.equal(mock.calls.length, 0);
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("bounds concurrent creation before request bodies or image transforms are admitted", async () => {
  const upstream = makeOpenAIMock();
  let releaseFirstModeration;
  let markFirstModerationStarted;
  const firstModerationStarted = new Promise((resolve) => {
    markFirstModerationStarted = resolve;
  });
  const moderationGate = new Promise((resolve) => {
    releaseFirstModeration = resolve;
  });
  let holdFirstModeration = true;
  const mock = {
    fetchImpl: async (url, options) => {
      if (holdFirstModeration && url.endsWith("/moderations")) {
        holdFirstModeration = false;
        markFirstModerationStarted();
        await moderationGate;
      }
      return upstream.fetchImpl(url, options);
    },
  };
  const context = await startPlatform(mock, { maxConcurrentCreates: 1 });
  let firstRequest;
  try {
    firstRequest = postJson(context.baseUrl, "/api/v1/stories", createBody(), {
      Authorization: `Bearer ${TEST_KEY}`,
    });
    await firstModerationStarted;
    const busy = await postJson(context.baseUrl, "/api/v1/stories", createBody(), {
      Authorization: `Bearer ${TEST_KEY}`,
    });
    assert.equal(busy.status, 503);
    assert.equal(busy.headers.get("retry-after"), "15");
    assert.equal((await busy.json()).error.code, "GENERATION_BUSY");

    releaseFirstModeration();
    assert.equal((await firstRequest).status, 201);
  } finally {
    releaseFirstModeration?.();
    await firstRequest?.catch(() => null);
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("startup removes incomplete staging and quarantines finalized media without database rows", async () => {
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "storyscrolls-platform-reconcile-"));
  const mock = makeOpenAIMock();
  const initial = await startPlatform(mock, { dataDir });
  await initial.platform.close();

  const stagedId = "249f9f28-446c-4f9b-9045-0c781fcbc66b";
  const orphanedId = "6f3b3343-0f27-49be-82da-a296b86d446b";
  await fsp.mkdir(path.join(dataDir, ".staging", stagedId));
  await fsp.writeFile(path.join(dataDir, ".staging", stagedId, "incoming"), "partial");
  await fsp.mkdir(path.join(dataDir, "media", orphanedId));
  await fsp.writeFile(path.join(dataDir, "media", orphanedId, "illustration.webp"), "final");

  const restarted = await startPlatform(mock, { dataDir });
  try {
    assert.equal(fs.existsSync(path.join(dataDir, ".staging", stagedId)), false);
    assert.equal(fs.existsSync(path.join(dataDir, "media", orphanedId)), false);
    const quarantined = await fsp.readdir(path.join(dataDir, ".orphaned-media"));
    assert.equal(quarantined.length, 1);
    assert.match(quarantined[0], new RegExp(`^${orphanedId}-`));
    assert.equal(
      fs.readFileSync(path.join(dataDir, ".orphaned-media", quarantined[0], "illustration.webp"), "utf8"),
      "final",
    );
    assert.ok(
      restarted.logs.some((entry) =>
        entry[0] === "storyscrolls storage reconciled"
        && entry[1].removedStagingDirectories === 1
        && entry[1].quarantinedMediaDirectories === 1),
    );
  } finally {
    await restarted.platform.close();
    await fsp.rm(dataDir, { recursive: true, force: true });
  }
});

test("three distinct reporters automatically unlist an approved text-only story for review", async () => {
  const mock = makeOpenAIMock();
  const context = await startPlatform(mock, { reportUnlistThreshold: 3 });
  try {
    const createdResponse = await postJson(context.baseUrl, "/api/v1/stories", createBody(), {
      Authorization: `Bearer ${TEST_KEY}`,
    });
    const created = await createdResponse.json();
    assert.equal(createdResponse.status, 201);
    assert.equal(context.platform.setListingStatus(created.story.slug, "approved"), true);
    for (let index = 1; index <= 3; index += 1) {
      const report = await postJson(
        context.baseUrl,
        "/api/v1/reports",
        { slug: created.story.slug, reason: "copyright", details: "Please review the rights record." },
        { "X-Storyscrolls-Session": `reporter-session-${index}-abcdef` },
      );
      assert.equal(report.status, 202);
    }
    const library = await fetch(`${context.baseUrl}/api/v1/library`).then((item) => item.json());
    assert.equal(library.community.length, 0);
    const sharedStory = await fetch(
      `${context.baseUrl}/api/v1/stories/${created.story.slug}`,
    ).then((item) => item.json());
    assert.equal(sharedStory.story.listing.status, "review");
  } finally {
    await context.platform.close();
    await fsp.rm(context.dataDir, { recursive: true, force: true });
  }
});

test("schema v2 migrates atomically to v5 while preserving legacy stories and assets", async () => {
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "storyscrolls-platform-v2-"));
  await fsp.mkdir(path.join(dataDir, "media", "legacy-story"), { recursive: true });
  const databasePath = path.join(dataDir, "storyscrolls.sqlite3");
  const db = new Database(databasePath);
  db.exec(`
    CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    INSERT INTO schema_meta VALUES ('schema_version', '2');
    CREATE TABLE stories (
      id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, author_name TEXT NOT NULL,
      synopsis TEXT NOT NULL, content_warnings_json TEXT NOT NULL, ast_json TEXT NOT NULL,
      theme_id TEXT NOT NULL, rights_basis TEXT NOT NULL, rights_statement TEXT NOT NULL,
      source_urls_json TEXT NOT NULL, moderation_status TEXT NOT NULL, moderation_json TEXT NOT NULL,
      public_requested INTEGER NOT NULL DEFAULT 0, visibility TEXT NOT NULL DEFAULT 'unlisted',
      listing_status TEXT NOT NULL DEFAULT 'unlisted', report_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE story_assets (
      id TEXT PRIMARY KEY, story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      role TEXT NOT NULL, filename TEXT NOT NULL, media_type TEXT NOT NULL, storage_path TEXT NOT NULL,
      byte_length INTEGER NOT NULL, sha256 TEXT NOT NULL, alt_text TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(story_id, filename), UNIQUE(storage_path)
    ) STRICT;
    CREATE TABLE moderation_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, story_id TEXT REFERENCES stories(id) ON DELETE CASCADE,
      stage TEXT NOT NULL, decision TEXT NOT NULL, categories_json TEXT NOT NULL, created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT, story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      reporter_fingerprint TEXT NOT NULL, reason TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(story_id, reporter_fingerprint, reason)
    ) STRICT;
    CREATE INDEX story_assets_story_idx ON story_assets(story_id);
  `);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO stories VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      "legacy-story", "legacy-story", "Legacy", "Author", "Synopsis", "[]", '{"chapters":[]}',
      "irish", "own", "", "[]", "safe", "{}", 0, "unlisted", "unlisted", 0, now, now,
    );
  const legacyPath = path.join(dataDir, "media", "legacy-story", "cover.webp");
  await fsp.writeFile(legacyPath, tinyWebp("legacy"));
  db.prepare(`INSERT INTO story_assets VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run("legacy-asset", "legacy-story", "cover", "cover.webp", "image/webp", legacyPath, tinyWebp("legacy").length, "a".repeat(64), "Legacy cover", now);
  db.close();

  const mock = makeOpenAIMock();
  const platform = createPlatformServer({
    dataDir,
    fetchImpl: mock.fetchImpl,
    allowedOrigins: [ORIGIN],
    fingerprintSecret: "test-only-fingerprint-secret",
  });
  await platform.close();
  const migrated = new Database(databasePath, { readonly: true });
  assert.equal(migrated.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get().value, "5");
  assert.equal(JSON.parse(migrated.prepare("SELECT illustration_policy_json FROM stories").get().illustration_policy_json).mode, "legacy");
  const asset = migrated.prepare("SELECT * FROM story_assets").get();
  assert.equal(asset.origin, "generated");
  assert.equal(asset.placement_kind, "legacy");
  assert.equal(asset.model, "gpt-image-1-mini");
  migrated.close();
  await fsp.rm(dataDir, { recursive: true, force: true });
});

test("schema v3 gains v5 placement and generation metadata without rebuilding unrelated tables", async () => {
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "storyscrolls-platform-v3-"));
  const mock = makeOpenAIMock();
  const initialized = createPlatformServer({
    dataDir,
    fetchImpl: mock.fetchImpl,
    allowedOrigins: [ORIGIN],
    fingerprintSecret: "test-only-fingerprint-secret",
  });
  await initialized.close();

  const databasePath = path.join(dataDir, "storyscrolls.sqlite3");
  const db = new Database(databasePath);
  db.exec(`
    BEGIN IMMEDIATE;
    DROP INDEX story_assets_story_idx;
    ALTER TABLE story_assets RENAME TO story_assets_v4;
    CREATE TABLE story_assets (
      id TEXT PRIMARY KEY,
      story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('cover', 'scene', 'illustration')),
      origin TEXT NOT NULL CHECK (origin IN ('generated', 'uploaded')),
      filename TEXT NOT NULL,
      original_filename TEXT,
      media_type TEXT NOT NULL CHECK (media_type = 'image/webp'),
      storage_path TEXT NOT NULL,
      byte_length INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      alt_text TEXT NOT NULL,
      creator_credit TEXT,
      model TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(story_id, filename),
      UNIQUE(storage_path)
    ) STRICT;
    DROP TABLE story_assets_v4;
    CREATE INDEX story_assets_story_idx ON story_assets(story_id);
    UPDATE schema_meta SET value = '3' WHERE key = 'schema_version';
    COMMIT;
  `);
  db.close();

  const migrated = createPlatformServer({
    dataDir,
    fetchImpl: mock.fetchImpl,
    allowedOrigins: [ORIGIN],
    fingerprintSecret: "test-only-fingerprint-secret",
  });
  await migrated.close();
  const verified = new Database(databasePath, { readonly: true });
  assert.equal(verified.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get().value, "5");
  const placementColumn = verified
    .prepare("PRAGMA table_info(story_assets)")
    .all()
    .find((column) => column.name === "placement_kind");
  assert.equal(placementColumn.notnull, 1);
  assert.equal(placementColumn.dflt_value, "'legacy'");
  verified.close();
  await fsp.rm(dataDir, { recursive: true, force: true });
});
