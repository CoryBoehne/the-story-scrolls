export const REFERENCE_AWAITING = "awaiting-reference-review";
export const REFERENCE_APPROVED = "reference-approved";

export function validBudgetOverride(value) {
  return value?.approved === true
    && value.authorizedBy === "user"
    && value.authorizedOn === "2026-07-21"
    && value.scope === "budget-gate-only"
    && value.reason === "contest release reliability prioritized; budget not a blocker";
}

function nonNegativeFinite(value) {
  return Number.isFinite(value) && value >= 0;
}

export function evaluateProofBudget({
  pairUpperUsd,
  priorProjectUpperUsd,
  campaignExecutedUpperUsd = 0,
  proofCapUsd = 12,
  totalProjectCapUsd = 25,
}) {
  if (
    !nonNegativeFinite(pairUpperUsd)
    || !nonNegativeFinite(priorProjectUpperUsd)
    || !nonNegativeFinite(campaignExecutedUpperUsd)
    || !nonNegativeFinite(proofCapUsd)
    || !nonNegativeFinite(totalProjectCapUsd)
  ) {
    return {
      allowed: false,
      reason: "invalid-budget",
      campaignUpperUsd: null,
      overallUpperUsd: null,
    };
  }
  const campaignUpperUsd = Number((campaignExecutedUpperUsd + pairUpperUsd).toFixed(2));
  const overallUpperUsd = Number((priorProjectUpperUsd + campaignUpperUsd).toFixed(2));
  if (campaignUpperUsd > proofCapUsd) {
    return { allowed: false, reason: "proof-cap", campaignUpperUsd, overallUpperUsd };
  }
  if (overallUpperUsd > totalProjectCapUsd) {
    return { allowed: false, reason: "project-cap", campaignUpperUsd, overallUpperUsd };
  }
  return { allowed: true, reason: null, campaignUpperUsd, overallUpperUsd };
}

export function prepareDisposition(
  entry,
  { nowMs = Date.now(), reviewFileReady = false } = {},
) {
  if (!entry) return { action: "create", reason: "new-proof" };
  if (
    entry.job?.id
    || entry.executedStages?.finalStory === true
    || entry.executedStages?.publicApproval === true
  ) {
    return { action: "block", reason: "production-checkpoint-exists" };
  }
  if (entry.status === REFERENCE_AWAITING) {
    if (!entry.characterBible?.id || !entry.characterBible?.referenceReviewPath) {
      return { action: "block", reason: "incomplete-review-checkpoint" };
    }
    const expiresAt = new Date(entry.characterBible.expiresAt).getTime();
    if (!Number.isFinite(expiresAt)) {
      return { action: "block", reason: "invalid-reference-expiry" };
    }
    if (expiresAt <= nowMs) return { action: "create", reason: "expired-review-reference" };
    if (!reviewFileReady) return { action: "block", reason: "review-file-unavailable" };
    return { action: "reuse", reason: "pending-review" };
  }
  if (/^reference-rejected(?:-|$)/.test(entry.status || "")) {
    return { action: "create", reason: "deliberately-rejected-reference" };
  }
  return { action: "block", reason: "non-review-safe-state" };
}

export function approvedReferenceDisposition(entry, fileState) {
  const approval = entry?.referenceApproval;
  if (
    entry?.referenceReviewStatus !== REFERENCE_APPROVED
    || approval?.status !== REFERENCE_APPROVED
  ) {
    return { allowed: false, reason: "reference-not-explicitly-approved" };
  }
  if (!entry.characterBible?.id || approval.characterBibleId !== entry.characterBible.id) {
    return { allowed: false, reason: "reference-id-mismatch" };
  }
  if (!fileState?.exists || !fileState.regular || !fileState.pathMatches) {
    return { allowed: false, reason: "approved-file-unavailable" };
  }
  if (!/^[a-f0-9]{64}$/.test(approval.sha256 || "")) {
    return { allowed: false, reason: "approved-hash-invalid" };
  }
  if (fileState.sha256 !== approval.sha256) {
    return { allowed: false, reason: "approved-hash-mismatch" };
  }
  if (
    Number.isInteger(approval.fileSizeBytes)
    && approval.fileSizeBytes !== fileState.fileSizeBytes
  ) {
    return { allowed: false, reason: "approved-size-mismatch" };
  }
  return { allowed: true, reason: null };
}

export function lockDisposition({
  owner,
  currentHostname,
  ownerAlive,
  ageMs,
  staleAfterMs,
  remoteStaleAfterMs,
}) {
  const validAge = Number.isFinite(ageMs) && ageMs >= 0;
  if (!owner || !Number.isInteger(owner.pid) || typeof owner.nonce !== "string") {
    return validAge && ageMs >= staleAfterMs ? "stale" : "busy";
  }
  if (owner.hostname !== currentHostname) {
    return validAge && ageMs >= remoteStaleAfterMs ? "stale" : "busy";
  }
  if (ownerAlive === true) return "busy";
  if (ownerAlive === false) return "stale";
  return validAge && ageMs >= staleAfterMs ? "stale" : "busy";
}
