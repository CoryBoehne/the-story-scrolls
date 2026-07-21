import assert from "node:assert/strict";
import test from "node:test";

import { moderateImageSet } from "../server/platform-server.mjs";

const TEST_KEY = "sk-test-image-moderation-batching-123456789";

function moderationResult({ reject = false, review = false } = {}) {
  return {
    flagged: reject || review,
    categories: {
      sexual: reject,
      violence: review,
    },
    category_scores: {
      sexual: reject ? 0.99 : 0.001,
      violence: review ? 0.8 : 0.01,
    },
  };
}

test("image-set moderation sends every one of 14 images in a provider-safe request", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/moderations");
    const body = JSON.parse(options.body);
    calls.push(body);
    return Response.json({ results: [moderationResult()] });
  };

  const decision = await moderateImageSet(
    fetchImpl,
    TEST_KEY,
    Array.from({ length: 14 }, (_, index) => Buffer.from(`image-${index}`)),
  );

  assert.equal(decision.decision, "safe");
  assert.equal(calls.length, 14);
  assert.ok(calls.every((call) => call.input.length === 1));
  assert.ok(calls.every((call) => call.input.every((item) => item.type === "image_url")));
});

test("image-set moderation aggregates review and rejection across 14 images", async () => {
  const calls = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    const callNumber = calls.length;
    return Response.json({
      results: [moderationResult({ review: callNumber === 1, reject: callNumber === 3 })],
    });
  };

  const decision = await moderateImageSet(
    fetchImpl,
    TEST_KEY,
    Array.from({ length: 14 }, (_, index) => Buffer.from(`image-${index}`)),
  );

  assert.equal(decision.decision, "reject");
  assert.equal(decision.categories.violence, true);
  assert.equal(decision.categories.sexual, true);
  assert.equal(decision.scores.violence, 0.8);
  assert.equal(decision.scores.sexual, 0.99);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.input.length === 1));
});
