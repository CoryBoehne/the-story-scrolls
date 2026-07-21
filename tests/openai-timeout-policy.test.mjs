import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { fetchOpenAI } from "../server/platform-server.mjs";

const source = await readFile(new URL("../server/platform-server.mjs", import.meta.url), "utf8");

test("durable frontier Responses calls use the long worker deadline", () => {
  assert.match(source, /const OPENAI_RESPONSES_TIMEOUT_MS = 15 \* 60_000;/);

  const responsesDeadlineReferences = source.match(/OPENAI_RESPONSES_TIMEOUT_MS/g) ?? [];
  assert.equal(
    responsesDeadlineReferences.length,
    6,
    "one declaration and all five Responses workflows must use the durable deadline",
  );

  const responseCalls = source.match(
    /OPENAI_RESPONSES_URL,[\s\S]*?OPENAI_RESPONSES_TIMEOUT_MS,\n\s*(?:\{ logger \},\n\s*)?\);/g,
  ) ?? [];
  assert.equal(responseCalls.length, 5);
  assert.equal(responseCalls.every((call) => !call.includes("OPENAI_TIMEOUT_MS")), true);
});

test("moderation retains the shorter network deadline", () => {
  const moderationCalls = source.match(
    /OPENAI_MODERATIONS_URL,[\s\S]*?OPENAI_TIMEOUT_MS,\n\s*(?:\{ logger \},\n\s*)?\);/g,
  ) ?? [];
  assert.equal(moderationCalls.length, 2);
  assert.equal(moderationCalls.every((call) => !call.includes("OPENAI_RESPONSES_TIMEOUT_MS")), true);
});

function stalledBodyResponse(status = 200) {
  return new Response(new ReadableStream({
    start() {
      // Headers arrive, but the provider never completes the response body.
    },
  }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("the OpenAI deadline covers a successful response body after headers arrive", async () => {
  let requestSignal;
  const startedAt = Date.now();
  await assert.rejects(
    fetchOpenAI(
      async (_url, options) => {
        requestSignal = options.signal;
        return stalledBodyResponse();
      },
      "https://api.openai.com/v1/moderations",
      "sk-test-never-sent",
      { model: "omni-moderation-latest", input: ["test"] },
      20,
    ),
    (error) => error?.code === "OPENAI_UNAVAILABLE",
  );

  assert.equal(requestSignal.aborted, true);
  assert.ok(Date.now() - startedAt < 1_000, "the stalled body must respect the request deadline");
});

test("the OpenAI deadline also bounds safe error-diagnostic body reads", async () => {
  let requestSignal;
  const logs = [];
  await assert.rejects(
    fetchOpenAI(
      async (_url, options) => {
        requestSignal = options.signal;
        return stalledBodyResponse(400);
      },
      "https://api.openai.com/v1/images/edits",
      "sk-test-never-sent",
      null,
      20,
      { logger: { error: (...args) => logs.push(args) } },
    ),
    (error) => error?.code === "OPENAI_UNAVAILABLE",
  );

  assert.equal(requestSignal.aborted, true);
  assert.deepEqual(logs, []);
});
