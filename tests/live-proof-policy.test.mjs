import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  approvedReferenceDisposition,
  evaluateProofBudget,
  lockDisposition,
  prepareDisposition,
  validBudgetOverride,
} from "../launch-fixtures/private/live-proof-policy.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.resolve(HERE, "../launch-fixtures/private/run-live-proofs.mjs");

function reviewEntry(overrides = {}) {
  return {
    status: "awaiting-reference-review",
    characterBible: {
      id: "11111111-1111-4111-8111-111111111111",
      expiresAt: "2099-01-01T00:00:00.000Z",
      referenceReviewPath: "/private/reference.webp",
    },
    job: null,
    executedStages: { finalStory: false, publicApproval: false },
    ...overrides,
  };
}

test("the final proof pair and total project budget have independent caps", () => {
  assert.deepEqual(
    evaluateProofBudget({
      pairUpperUsd: 7.4,
      priorProjectUpperUsd: 9.81,
      campaignExecutedUpperUsd: 3.61,
    }),
    {
      allowed: true,
      reason: null,
      campaignUpperUsd: 11.01,
      overallUpperUsd: 20.82,
    },
  );
  assert.equal(
    evaluateProofBudget({
      pairUpperUsd: 8.4,
      priorProjectUpperUsd: 0,
      campaignExecutedUpperUsd: 3.61,
    }).reason,
    "proof-cap",
  );
  assert.equal(
    evaluateProofBudget({
      pairUpperUsd: 7.4,
      priorProjectUpperUsd: 14.5,
      campaignExecutedUpperUsd: 3.61,
    }).reason,
    "project-cap",
  );
});

test("only the exact persisted user authorization satisfies the budget-only override", () => {
  const override = {
    approved: true,
    authorizedBy: "user",
    authorizedOn: "2026-07-21",
    scope: "budget-gate-only",
    reason: "contest release reliability prioritized; budget not a blocker",
  };
  assert.equal(validBudgetOverride(override), true);
  assert.equal(validBudgetOverride({ ...override, scope: "all-gates" }), false);
  assert.equal(validBudgetOverride({ ...override, approved: false }), false);
});

test("prepare only creates or reuses references in review-safe states", () => {
  assert.equal(prepareDisposition(null).action, "create");
  assert.equal(prepareDisposition(reviewEntry(), { reviewFileReady: true }).action, "reuse");
  assert.equal(
    prepareDisposition(reviewEntry({
      characterBible: {
        id: "11111111-1111-4111-8111-111111111111",
        expiresAt: "2020-01-01T00:00:00.000Z",
        referenceReviewPath: "/private/reference.webp",
      },
    }), { reviewFileReady: true }).action,
    "create",
  );
  assert.equal(
    prepareDisposition(reviewEntry({ status: "reference-rejected-incomplete-cast" })).action,
    "create",
  );
  assert.equal(
    prepareDisposition(reviewEntry({ job: { id: "durable-job" }, status: "running" })).reason,
    "production-checkpoint-exists",
  );
  assert.equal(prepareDisposition(reviewEntry({ status: "published" })).action, "block");
  assert.equal(prepareDisposition(reviewEntry(), { reviewFileReady: false }).action, "block");
});

test("publish requires the exact deliberately approved reference file", () => {
  const sha256 = "a".repeat(64);
  const entry = reviewEntry({
    status: "reference-approved",
    referenceReviewStatus: "reference-approved",
    referenceApproval: {
      status: "reference-approved",
      characterBibleId: "11111111-1111-4111-8111-111111111111",
      sha256,
      fileSizeBytes: 1024,
    },
  });
  const file = {
    exists: true,
    regular: true,
    pathMatches: true,
    sha256,
    fileSizeBytes: 1024,
  };
  assert.equal(approvedReferenceDisposition(entry, file).allowed, true);
  assert.equal(
    approvedReferenceDisposition(entry, { ...file, sha256: "b".repeat(64) }).reason,
    "approved-hash-mismatch",
  );
  assert.equal(
    approvedReferenceDisposition({ ...entry, referenceReviewStatus: null }, file).reason,
    "reference-not-explicitly-approved",
  );
});

test("lock policy blocks live or recent owners and recovers only stale locks", () => {
  const owner = { pid: 123, nonce: "nonce", hostname: "local" };
  const base = {
    owner,
    currentHostname: "local",
    ageMs: 1_000,
    staleAfterMs: 300_000,
    remoteStaleAfterMs: 21_600_000,
  };
  assert.equal(lockDisposition({ ...base, ownerAlive: true }), "busy");
  assert.equal(lockDisposition({ ...base, ownerAlive: false }), "stale");
  assert.equal(lockDisposition({ ...base, owner: null, ownerAlive: null }), "busy");
  assert.equal(
    lockDisposition({ ...base, owner: null, ownerAlive: null, ageMs: 400_000 }),
    "stale",
  );
});

test("runner exposes an explicit approval command and stages both results before publication", () => {
  const source = fs.readFileSync(RUNNER, "utf8");
  assert.match(source, /approve-reference/);
  assert.match(source, /approve-safe-retry/);
  assert.match(source, /reconcileLedgerJobs/);
  assert.match(source, /RECONCILE_WARNING/);
  assert.match(source, /acquireExclusiveLock/);
  const publishStart = source.indexOf("async function publish");
  const referenceGate = source.indexOf("await requireApprovedReferences", publishStart);
  const overrideGate = source.indexOf("const budgetOverride", publishStart);
  assert.ok(publishStart >= 0 && referenceGate > publishStart && overrideGate > referenceGate);
  const stage = source.indexOf("await stageAllGeneratedStories");
  const approve = source.indexOf("await approveAllStagedStories");
  assert.ok(stage >= 0 && approve > stage);
});
