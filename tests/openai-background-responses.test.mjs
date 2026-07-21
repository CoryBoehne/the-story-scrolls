import assert from "node:assert/strict";
import test from "node:test";

import { fetchOpenAI } from "../server/platform-server.mjs";

const RESPONSES_URL = "https://api.openai.com/v1/responses";
const TEST_KEY = "sk-test-background-mode-never-sent";

test("Responses requests use background mode and poll queued work through completion", async () => {
  const calls = [];
  let retrievals = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (options.method === "POST") {
      return Response.json({ id: "resp_background_123", status: "queued" });
    }
    retrievals += 1;
    return Response.json(
      retrievals === 1
        ? { id: "resp_background_123", status: "in_progress" }
        : {
            id: "resp_background_123",
            status: "completed",
            output_text: "finished safely",
          },
    );
  };

  const result = await fetchOpenAI(
    fetchImpl,
    RESPONSES_URL,
    TEST_KEY,
    { model: "gpt-5.6-luna", store: false, input: "private prompt" },
    1_000,
    { responsesPollIntervalMs: 1 },
  );

  assert.equal(result.status, "completed");
  assert.equal(result.output_text, "finished safely");
  assert.equal(calls.length, 3);
  assert.deepEqual(
    calls.map(({ url, options }) => ({ url, method: options.method })),
    [
      { url: RESPONSES_URL, method: "POST" },
      { url: `${RESPONSES_URL}/resp_background_123`, method: "GET" },
      { url: `${RESPONSES_URL}/resp_background_123`, method: "GET" },
    ],
  );
  const createBody = JSON.parse(calls[0].options.body);
  assert.equal(createBody.background, true);
  assert.equal(createBody.store, false);
  assert.equal(calls[1].options.body, undefined);
  assert.equal(calls[1].options.headers.Authorization, `Bearer ${TEST_KEY}`);
});

test("terminal background failures are generic and never log provider content", async () => {
  const privateProviderText = `private failure detail containing ${TEST_KEY}`;
  for (const status of ["failed", "cancelled", "incomplete"]) {
    const logs = [];
    let thrown;
    try {
      await fetchOpenAI(
        async () => Response.json({
          id: `resp_terminal_${status}`,
          status,
          error: { message: privateProviderText },
          incomplete_details: { reason: privateProviderText },
        }),
        RESPONSES_URL,
        TEST_KEY,
        { model: "gpt-5.6-luna", store: false, input: "private prompt" },
        1_000,
        {
          logger: { error: (...args) => logs.push(args) },
          responsesPollIntervalMs: 1,
        },
      );
    } catch (error) {
      thrown = error;
    }

    assert.equal(thrown?.status, 502);
    assert.equal(thrown?.code, "OPENAI_ERROR");
    assert.equal(thrown?.message, "OpenAI could not complete this request.");
    assert.deepEqual(logs, []);
    assert.equal(JSON.stringify(thrown).includes(privateProviderText), false);
    assert.equal(JSON.stringify(thrown).includes(TEST_KEY), false);
  }
});

test("background response ids are validated before any retrieval", async () => {
  let calls = 0;
  await assert.rejects(
    fetchOpenAI(
      async () => {
        calls += 1;
        return Response.json({ id: "https://attacker.invalid/response", status: "queued" });
      },
      RESPONSES_URL,
      TEST_KEY,
      { model: "gpt-5.6-luna", store: false, input: "private prompt" },
      1_000,
      { responsesPollIntervalMs: 1 },
    ),
    (error) => error?.code === "OPENAI_ERROR",
  );
  assert.equal(calls, 1);
});

test("the original Responses deadline includes background polling", async () => {
  const requestSignals = [];
  const startedAt = Date.now();
  await assert.rejects(
    fetchOpenAI(
      async (_url, options) => {
        requestSignals.push(options.signal);
        return Response.json({ id: "resp_never_finishes", status: "queued" });
      },
      RESPONSES_URL,
      TEST_KEY,
      { model: "gpt-5.6-luna", store: false, input: "private prompt" },
      25,
      { responsesPollIntervalMs: 1 },
    ),
    (error) => error?.code === "OPENAI_UNAVAILABLE",
  );

  assert.ok(requestSignals.length > 1);
  assert.ok(requestSignals.every((signal) => signal === requestSignals[0]));
  assert.equal(requestSignals[0].aborted, true);
  assert.ok(Date.now() - startedAt < 1_000);
});
