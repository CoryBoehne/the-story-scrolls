import assert from "node:assert/strict";
import test from "node:test";

import {
  creatorFacingCreationError,
  IMAGE_SAFETY_REVISION_REQUIRED_MESSAGE,
} from "../shared/creation-error-guidance.mjs";

test("creator guidance replaces image-safety provider details with a stable next step", () => {
  const result = creatorFacingCreationError({
    code: "IMAGE_SAFETY_REVISION_REQUIRED",
    message: "private upstream prompt details must never be shown",
  });

  assert.equal(result, IMAGE_SAFETY_REVISION_REQUIRED_MESSAGE);
  assert.match(result, /not a judgment about your story/i);
  assert.match(result, /revise the visual direction or character\/reference descriptions/i);
  assert.match(result, /prepare and approve a new visual guide/i);
  assert.match(result, /no automatic retry was made/i);
  assert.doesNotMatch(result, /private upstream/i);
});

test("creator guidance preserves other public server messages and has a safe fallback", () => {
  assert.equal(
    creatorFacingCreationError({ code: "OPENAI_RATE_LIMITED", message: "Try again later." }),
    "Try again later.",
  );
  assert.equal(creatorFacingCreationError(null), "The scroll could not be created.");
});
