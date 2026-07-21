import assert from "node:assert/strict";
import test from "node:test";

import { prioritizeIllustrationPlans } from "../server/platform-server.mjs";

function plan(id, placementKind, chapterNumber = null, afterBlockIndex = null) {
  return { id, placementKind, chapterNumber, afterBlockIndex };
}

test("paid illustration work prioritizes the complete narrative minimum before enrichment", () => {
  const plans = [
    plan("chapter-2-extra", "inline", 2, 8),
    plan("hero-2", "chapter-hero", 2),
    plan("chapter-1-extra", "inline", 1, 7),
    plan("cover", "cover"),
    plan("chapter-2-minimum", "inline", 2, 2),
    plan("hero-1", "chapter-hero", 1),
    plan("chapter-1-minimum", "inline", 1, 1),
  ];

  const prioritized = prioritizeIllustrationPlans(plans);
  assert.deepEqual(
    prioritized.map(({ id }) => id),
    [
      "cover",
      "hero-1",
      "hero-2",
      "chapter-1-minimum",
      "chapter-2-minimum",
      "chapter-1-extra",
      "chapter-2-extra",
    ],
  );
  assert.deepEqual(
    plans.map(({ id }) => id),
    [
      "chapter-2-extra",
      "hero-2",
      "chapter-1-extra",
      "cover",
      "chapter-2-minimum",
      "hero-1",
      "chapter-1-minimum",
    ],
    "priority planning must not mutate the model package",
  );
});
