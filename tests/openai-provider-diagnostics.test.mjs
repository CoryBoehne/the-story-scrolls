import assert from "node:assert/strict";
import test from "node:test";

import { fetchOpenAI } from "../server/platform-server.mjs";

const PRIVATE_KEY = "sk-test-private-key-that-must-not-appear";
const PRIVATE_MESSAGE = `private provider detail with prompt text and ${PRIVATE_KEY}`;

async function rejectedProviderCall(url, status, errorCode, errorType) {
  const logs = [];
  let thrown;
  try {
    await fetchOpenAI(
      async () => new Response(JSON.stringify({
        error: {
          code: errorCode,
          type: errorType,
          message: PRIVATE_MESSAGE,
          private_body: "never log the provider body",
        },
      }), {
        status,
        headers: {
          "content-type": "application/json",
          "x-request-id": `req_safe_${status}`,
        },
      }),
      url,
      PRIVATE_KEY,
      { privatePrompt: PRIVATE_MESSAGE },
      1_000,
      { logger: { error: (...args) => logs.push(args) } },
    );
  } catch (error) {
    thrown = error;
  }
  return { logs, thrown };
}

test("Responses failures log only endpoint class and bounded diagnostic identifiers", async () => {
  const { logs, thrown } = await rejectedProviderCall(
    "https://api.openai.com/v1/responses",
    500,
    "server_error",
    "server_error",
  );

  assert.equal(thrown?.code, "OPENAI_ERROR");
  assert.equal(thrown?.message, "OpenAI could not complete this request.");
  assert.deepEqual(logs, [["openai provider failure", {
    endpointClass: "responses",
    status: 500,
    requestId: "req_safe_500",
    errorCode: "server_error",
    errorType: "server_error",
  }]]);
  const serialized = JSON.stringify({ logs, thrown: { code: thrown?.code, message: thrown?.message } });
  assert.equal(serialized.includes(PRIVATE_KEY), false);
  assert.equal(serialized.includes(PRIVATE_MESSAGE), false);
  assert.equal(serialized.includes("private_body"), false);
});

test("an unreadable successful Responses body logs safe transport facts before the client error", async () => {
  const logs = [];
  let thrown;
  try {
    await fetchOpenAI(
      async () => new Response(PRIVATE_MESSAGE, {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-request-id": "req_safe_unreadable",
        },
      }),
      "https://api.openai.com/v1/responses",
      PRIVATE_KEY,
      { privatePrompt: PRIVATE_MESSAGE },
      1_000,
      { logger: { error: (...args) => logs.push(args) } },
    );
  } catch (error) {
    thrown = error;
  }

  assert.equal(thrown?.code, "OPENAI_ERROR");
  assert.equal(thrown?.message, "OpenAI returned an unreadable response.");
  assert.deepEqual(logs, [["openai provider failure", {
    endpointClass: "responses",
    status: 200,
    requestId: "req_safe_unreadable",
    errorCode: "unreadable_response",
    errorType: "provider_response_parse_error",
  }]]);
  assert.equal(JSON.stringify(logs).includes(PRIVATE_KEY), false);
  assert.equal(JSON.stringify(logs).includes(PRIVATE_MESSAGE), false);
});

test("moderation 400 and 413 failures retain safe client mapping and redacted diagnostics", async () => {
  for (const status of [400, 413]) {
    const { logs, thrown } = await rejectedProviderCall(
      "https://api.openai.com/v1/moderations",
      status,
      status === 400 ? "invalid_request" : "request_too_large",
      "invalid_request_error",
    );

    assert.equal(thrown?.status, 502);
    assert.equal(thrown?.code, "OPENAI_ERROR");
    assert.equal(thrown?.message, "OpenAI could not complete this request.");
    assert.deepEqual(logs, [["openai provider failure", {
      endpointClass: "moderation",
      status,
      requestId: `req_safe_${status}`,
      errorCode: status === 400 ? "invalid_request" : "request_too_large",
      errorType: "invalid_request_error",
    }]]);
    const serialized = JSON.stringify({ logs, thrown: { code: thrown?.code, message: thrown?.message } });
    assert.equal(serialized.includes(PRIVATE_KEY), false);
    assert.equal(serialized.includes(PRIVATE_MESSAGE), false);
    assert.equal(serialized.includes("private_body"), false);
  }
});
