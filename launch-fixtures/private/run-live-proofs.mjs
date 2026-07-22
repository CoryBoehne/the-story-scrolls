#!/usr/bin/env node

import crypto from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  REFERENCE_APPROVED,
  REFERENCE_AWAITING,
  approvedReferenceDisposition,
  evaluateProofBudget,
  lockDisposition,
  prepareDisposition,
  validBudgetOverride,
} from "./live-proof-policy.mjs";

const execFile = promisify(execFileCallback);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, "../..");
const PLATFORM_NODE_BIN = "/Users/coryboehne/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node";
const KEYCHAIN_SERVICE = "com.corydev.thestoryscrolls.openai-api-key";
const KEYCHAIN_ACCOUNT = "coryboehne";
const LEDGER_FILE = path.join(HERE, "live-proof-budget-ledger.json");
const REVIEW_DIR = path.join(HERE, ".reference-review");
const LOCK_DIR = path.join(HERE, ".run-live-proofs.lock");
const LOCK_OWNER_FILE = "owner.json";
const ORIGIN = "https://thestoryscrolls.com";
const SESSION = "launchproofs20260721";
const MAX_COMBINED_APPROVED_USD = 12;
const MAX_TOTAL_PROJECT_TEST_USD = 25;
const POLL_INTERVAL_MS = 5_000;
const MAX_JOB_WAIT_MS = 45 * 60 * 1_000;
const STALE_LOCK_MS = 5 * 60 * 1_000;
const REMOTE_STALE_LOCK_MS = 6 * 60 * 60 * 1_000;
const API_BASE = new URL(process.env.STORYSCROLLS_PROOF_API || "http://127.0.0.1:4307");

const FIXTURES = [
  {
    key: "lanternmakers-map",
    filename: "the-lanternmakers-map.request.json",
  },
  {
    key: "christmas-carol-clearer-road",
    filename: "a-christmas-carol-a-clearer-road.request.json",
  },
];

if (
  API_BASE.protocol !== "http:"
  || API_BASE.hostname !== "127.0.0.1"
  || API_BASE.username
  || API_BASE.password
  || API_BASE.pathname !== "/"
) {
  throw new Error("The live proof runner is restricted to an unauthenticated 127.0.0.1 loopback API URL.");
}

function safeMessage(error) {
  if (error instanceof Error && /^[\p{L}\p{N} $.,;:!?()'’/\-_–—]+$/u.test(error.message)) {
    return error.message.slice(0, 500);
  }
  return "The proof runner stopped at a protected API boundary.";
}

async function readLockOwner(lockDir = LOCK_DIR) {
  try {
    const raw = await fs.readFile(path.join(lockDir, LOCK_OWNER_FILE), "utf8");
    const owner = JSON.parse(raw);
    return { raw, owner };
  } catch {
    return { raw: null, owner: null };
  }
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    return null;
  }
}

async function restoreMovedLock(quarantine) {
  try {
    await fs.rename(quarantine, LOCK_DIR);
  } catch {
    // A new owner may already hold the canonical lock. Preserve the moved
    // directory for manual inspection rather than deleting uncertain state.
  }
}

async function acquireExclusiveLock(command) {
  const hostname = os.hostname();
  const nonce = crypto.randomBytes(16).toString("hex");
  const owner = {
    version: 1,
    pid: process.pid,
    hostname,
    nonce,
    command,
    startedAt: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await fs.mkdir(LOCK_DIR, { mode: 0o700 });
      try {
        await fs.writeFile(
          path.join(LOCK_DIR, LOCK_OWNER_FILE),
          `${JSON.stringify(owner, null, 2)}\n`,
          { mode: 0o600, flag: "wx" },
        );
      } catch (error) {
        await fs.rm(LOCK_DIR, { recursive: true, force: true });
        throw error;
      }
      return async () => {
        const current = await readLockOwner();
        if (current.owner?.nonce === nonce && current.owner?.pid === process.pid) {
          await fs.rm(LOCK_DIR, { recursive: true, force: true });
        }
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }

    const observed = await readLockOwner();
    let lockStat;
    try {
      lockStat = await fs.stat(LOCK_DIR);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    const sameHost = observed.owner?.hostname === hostname;
    const disposition = lockDisposition({
      owner: observed.owner,
      currentHostname: hostname,
      ownerAlive: sameHost ? processIsAlive(observed.owner?.pid) : null,
      ageMs: Math.max(0, Date.now() - lockStat.mtimeMs),
      staleAfterMs: STALE_LOCK_MS,
      remoteStaleAfterMs: REMOTE_STALE_LOCK_MS,
    });
    if (disposition !== "stale") {
      throw new Error(
        `LOCKED: proof command ${observed.owner?.command || "unknown"} is already active under PID ${observed.owner?.pid || "unknown"}.`,
      );
    }

    const quarantine = `${LOCK_DIR}.stale.${process.pid}.${crypto.randomBytes(6).toString("hex")}`;
    try {
      await fs.rename(LOCK_DIR, quarantine);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    const moved = await readLockOwner(quarantine);
    if (moved.raw !== observed.raw) {
      await restoreMovedLock(quarantine);
      throw new Error("LOCKED: the proof lock changed while stale-lock recovery was in progress.");
    }
    await fs.rm(quarantine, { recursive: true, force: true });
  }
  throw new Error("LOCKED: the proof runner could not acquire its exclusive process lock.");
}

async function readJsonFile(filename) {
  return JSON.parse(await fs.readFile(filename, "utf8"));
}

async function readLedger() {
  try {
    return await readJsonFile(LEDGER_FILE);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return {
      version: 1,
      updatedAt: null,
      budgetCapUsd: MAX_COMBINED_APPROVED_USD,
      credentials: {
        apiKeyStored: false,
        bearerHeaderStored: false,
        approvalTokensStored: false,
      },
      actualProviderSpendUsd: null,
      actualProviderSpendNote: "The provider does not return account charges through this workflow; the ledger records approved server estimates and executed request counts instead.",
      proofs: {},
      totalApprovedEstimate: null,
    };
  }
}

async function writeLedger(ledger) {
  ledger.updatedAt = new Date().toISOString();
  const temporary = `${LEDGER_FILE}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(ledger, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  await fs.rename(temporary, LEDGER_FILE);
  await fs.chmod(LEDGER_FILE, 0o600);
}

async function readApiKey() {
  const { stdout } = await execFile(
    "/usr/bin/security",
    [
      "find-generic-password",
      "-a",
      KEYCHAIN_ACCOUNT,
      "-s",
      KEYCHAIN_SERVICE,
      "-w",
    ],
    { timeout: 10_000, maxBuffer: 4 * 1024 },
  );
  const key = stdout.trim();
  if (key.length < 20 || key.length > 400 || /\s/.test(key)) {
    throw new Error("The Story Scrolls Keychain entry does not contain one valid OpenAI API key.");
  }
  return key;
}

async function apiJson(
  pathname,
  {
    method = "GET",
    body,
    apiKey,
    idempotencyKey,
    timeoutMs = 20 * 60 * 1_000,
    retryNetworkOnce = false,
  } = {},
) {
  const attemptRequest = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = {
        Accept: "application/json",
        Origin: ORIGIN,
        "X-Storyscrolls-Session": SESSION,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      };
      const response = await fetch(new URL(pathname, API_BASE), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const contentLength = Number(response.headers.get("content-length") || 0);
      if (Number.isFinite(contentLength) && contentLength > 8 * 1024 * 1024) {
        await response.body?.cancel();
        throw new Error("The loopback API returned an unexpectedly large response.");
      }
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const code = typeof payload?.error?.code === "string" ? payload.error.code : `HTTP_${response.status}`;
        const message = typeof payload?.error?.message === "string"
          ? payload.error.message
          : "The loopback API rejected a protected proof step.";
        const error = new Error(`${code}: ${message}`);
        error.code = code;
        error.status = response.status;
        throw error;
      }
      return payload;
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    return await attemptRequest();
  } catch (error) {
    if (!retryNetworkOnce || error?.status) throw error;
    await new Promise((resolve) => setTimeout(resolve, 750));
    return attemptRequest();
  }
}

async function fetchReference(pathname, destination) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(new URL(pathname, API_BASE), {
      headers: {
        Accept: "image/webp",
        Origin: ORIGIN,
        "X-Storyscrolls-Session": SESSION,
      },
      signal: controller.signal,
    });
    if (!response.ok || response.headers.get("content-type") !== "image/webp") {
      throw new Error("The private character reference could not be retrieved for review.");
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 16 || bytes.length > 4 * 1024 * 1024) {
      bytes.fill(0);
      throw new Error("The private character reference size was invalid.");
    }
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await fs.writeFile(destination, bytes, { mode: 0o600, flag: "w" });
  } finally {
    clearTimeout(timer);
  }
}

function expectedReviewPath(descriptorKey, characterBibleId) {
  return path.resolve(REVIEW_DIR, `${descriptorKey}-${characterBibleId}.webp`);
}

async function inspectTrackedReviewFile(descriptorKey, entry, { includeHash = false } = {}) {
  const tracked = entry?.characterBible?.referenceReviewPath;
  const bibleId = entry?.characterBible?.id;
  if (!tracked || !bibleId) {
    return {
      exists: false,
      regular: false,
      pathMatches: false,
      sha256: null,
      fileSizeBytes: null,
    };
  }
  const candidate = path.resolve(tracked);
  const pathMatches = candidate === expectedReviewPath(descriptorKey, bibleId);
  if (!pathMatches || path.dirname(candidate) !== path.resolve(REVIEW_DIR)) {
    return {
      exists: false,
      regular: false,
      pathMatches: false,
      sha256: null,
      fileSizeBytes: null,
    };
  }
  let stats;
  try {
    stats = await fs.lstat(candidate);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        exists: false,
        regular: false,
        pathMatches: true,
        sha256: null,
        fileSizeBytes: null,
      };
    }
    throw error;
  }
  const regular = stats.isFile() && !stats.isSymbolicLink();
  if (!regular || stats.size < 16 || stats.size > 4 * 1024 * 1024) {
    return {
      exists: true,
      regular,
      pathMatches: true,
      sha256: null,
      fileSizeBytes: stats.size,
    };
  }
  if (!includeHash) {
    return {
      exists: true,
      regular: true,
      pathMatches: true,
      sha256: null,
      fileSizeBytes: stats.size,
    };
  }
  const bytes = await fs.readFile(candidate);
  try {
    const isWebp = bytes.subarray(0, 4).toString("ascii") === "RIFF"
      && bytes.subarray(8, 12).toString("ascii") === "WEBP";
    if (!isWebp) {
      return {
        exists: true,
        regular: true,
        pathMatches: true,
        sha256: null,
        fileSizeBytes: stats.size,
      };
    }
    return {
      exists: true,
      regular: true,
      pathMatches: true,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      fileSizeBytes: stats.size,
    };
  } finally {
    bytes.fill(0);
  }
}

function characterRequest(fixture, estimate) {
  return {
    creativeBrief: fixture.creativeBrief,
    source: fixture.source,
    sourceMetadata: fixture.sourceMetadata,
    rights: fixture.rights,
    visualStyle: fixture.generation.visualStyle,
    artDirection: fixture.generation.artDirection,
    generation: {
      writingTier: estimate.inputs.writingTier,
      continuityCharacters: fixture.generation.continuityCharacters,
    },
    audience: fixture.generation.audience,
    transformation: fixture.generation.transformation,
  };
}

async function estimateFixtures() {
  const values = [];
  for (const descriptor of FIXTURES) {
    const fixture = await readJsonFile(path.join(HERE, descriptor.filename));
    const response = await apiJson("/api/v1/estimates", {
      method: "POST",
      body: fixture,
      timeoutMs: 90_000,
    });
    if (!response?.estimate || !response?.approval?.token) {
      throw new Error(`The estimate response for ${descriptor.key} was incomplete.`);
    }
    values.push({ descriptor, fixture, response });
  }
  const minimum = Number(values.reduce(
    (sum, item) => sum + item.response.estimate.estimatedMinUsd,
    0,
  ).toFixed(2));
  const maximum = Number(values.reduce(
    (sum, item) => sum + item.response.estimate.estimatedMaxUsd,
    0,
  ).toFixed(2));
  if (!Number.isFinite(maximum) || maximum > MAX_COMBINED_APPROVED_USD) {
    throw new Error(
      `BUDGET_GATE: combined upper estimate ${maximum.toFixed(2)} exceeds ${MAX_COMBINED_APPROVED_USD.toFixed(2)}. No provider work was started.`,
    );
  }
  return { values, minimum, maximum };
}

function safeEstimate(estimate) {
  return {
    catalogVersion: estimate.catalogVersion,
    estimatedMinUsd: estimate.estimatedMinUsd,
    estimatedMaxUsd: estimate.estimatedMaxUsd,
    writingModel: estimate.inputs.writingModel,
    reasoningEffort: estimate.inputs.reasoningEffort,
    estimatedTextRequests: estimate.inputs.estimatedTextRequests,
    imageModel: estimate.inputs.imageModel,
    imageQuality: estimate.inputs.imageQuality,
    visibleImageCount: estimate.inputs.visibleImageCount,
    continuityReferenceImages: estimate.inputs.continuityReferenceImages,
  };
}

async function prepare(targetKey = null) {
  const selectedDescriptors = targetKey
    ? FIXTURES.filter((item) => item.key === targetKey)
    : FIXTURES;
  if (targetKey && selectedDescriptors.length !== 1) {
    throw new Error(`Unknown proof fixture ${targetKey}.`);
  }
  const ledger = await readLedger();
  const preparationPlan = [];
  for (const descriptor of selectedDescriptors) {
    const existing = ledger.proofs[descriptor.key];
    const fileState = existing?.status === REFERENCE_AWAITING
      ? await inspectTrackedReviewFile(descriptor.key, existing)
      : null;
    const disposition = prepareDisposition(existing, {
      reviewFileReady: Boolean(
        fileState?.exists && fileState.regular && fileState.pathMatches,
      ),
    });
    if (disposition.action === "block") {
      throw new Error(
        `${descriptor.key}: prepare is blocked in ${existing?.status || "unknown"} state (${disposition.reason}). Reconcile or use the existing production checkpoint; it will not be reset.`,
      );
    }
    preparationPlan.push({ descriptor, existing, disposition });
  }

  const estimated = await estimateFixtures();
  const selected = estimated.values.filter((item) => (
    selectedDescriptors.some((descriptor) => descriptor.key === item.descriptor.key)
  ));
  process.stdout.write(
    `Budget gate passed: $${estimated.minimum.toFixed(2)}–$${estimated.maximum.toFixed(2)} (hard upper limit $${MAX_COMBINED_APPROVED_USD.toFixed(2)}).\n`,
  );
  ledger.totalApprovedEstimate = {
    status: "awaiting-reference-review",
    estimatedMinUsd: estimated.minimum,
    estimatedMaxUsd: estimated.maximum,
    catalogVersion: estimated.values[0].response.estimate.catalogVersion,
  };
  let apiKey = preparationPlan.some(({ disposition }) => disposition.action === "create")
    ? await readApiKey()
    : null;
  try {
    for (const item of selected) {
      const planned = preparationPlan.find(({ descriptor }) => descriptor.key === item.descriptor.key);
      const existing = planned.existing;
      if (planned.disposition.action === "reuse") {
        process.stdout.write(`${item.fixture.title}: reusing the pending private reference checkpoint.\n`);
        continue;
      }
      process.stdout.write(`${item.fixture.title}: preparing the private character and style reference…\n`);
      const response = await apiJson("/api/v1/character-bibles", {
        method: "POST",
        body: characterRequest(item.fixture, item.response.estimate),
        apiKey,
      });
      const bible = response?.characterBible;
      if (!bible?.id || !bible?.reference?.url) {
        throw new Error(`The character reference response for ${item.descriptor.key} was incomplete.`);
      }
      const reviewPath = path.join(REVIEW_DIR, `${item.descriptor.key}-${bible.id}.webp`);
      await fetchReference(bible.reference.url, reviewPath);
      ledger.proofs[item.descriptor.key] = {
        fixture: item.descriptor.filename,
        title: item.fixture.title,
        status: REFERENCE_AWAITING,
        referenceReviewStatus: REFERENCE_AWAITING,
        referenceApproval: null,
        estimate: safeEstimate(item.response.estimate),
        characterBible: {
          id: bible.id,
          expiresAt: bible.expiresAt,
          referenceReviewPath: reviewPath,
          model: bible.reference.model,
          quality: bible.reference.quality,
          estimatedOutputUsd: bible.reference.estimatedOutputUsd,
        },
        idempotencyKey: crypto.randomUUID(),
        job: null,
        result: null,
        characterBibleHistory: [
          ...(Array.isArray(existing?.characterBibleHistory) ? existing.characterBibleHistory : []),
          ...(existing?.characterBible?.id
            ? [{
                id: existing.characterBible.id,
                status: `superseded-${existing.status || "review-reference"}`,
                retiredAt: new Date().toISOString(),
              }]
            : []),
        ],
        jobHistory: Array.isArray(existing?.jobHistory) ? existing.jobHistory : [],
        executedStages: {
          characterBibleAndReference: true,
          finalStory: false,
          publicApproval: false,
        },
      };
      await writeLedger(ledger);
    }
  } finally {
    apiKey = null;
  }
  await writeLedger(ledger);
  process.stdout.write(`References ready for visual review in ${REVIEW_DIR}. No story job was submitted.\n`);
}

async function approveReference(targetKey) {
  const descriptor = FIXTURES.find((item) => item.key === targetKey);
  if (!descriptor) {
    throw new Error("approve-reference requires exactly one known fixture key.");
  }
  const ledger = await readLedger();
  const entry = ledger.proofs[descriptor.key];
  if (!entry?.characterBible?.id) {
    throw new Error(`${descriptor.key}: no tracked reference is available to approve.`);
  }
  if (/^reference-rejected(?:-|$)/.test(entry.status || "")) {
    throw new Error(`${descriptor.key}: the tracked reference was rejected; prepare a fresh reference before approval.`);
  }
  if (new Date(entry.characterBible.expiresAt).getTime() <= Date.now()) {
    throw new Error(`${descriptor.key}: the tracked reference expired; prepare and review a fresh reference.`);
  }
  const fileState = await inspectTrackedReviewFile(descriptor.key, entry, { includeHash: true });
  if (
    !fileState.exists
    || !fileState.regular
    || !fileState.pathMatches
    || !fileState.sha256
  ) {
    throw new Error(`${descriptor.key}: the exact tracked WebP review file is unavailable or invalid.`);
  }
  if (entry.referenceReviewStatus === REFERENCE_APPROVED) {
    const disposition = approvedReferenceDisposition(entry, fileState);
    if (!disposition.allowed) {
      throw new Error(`${descriptor.key}: the approved reference no longer matches (${disposition.reason}).`);
    }
    process.stdout.write(`${descriptor.key}: reference approval already matches ${fileState.sha256}.\n`);
    return;
  }
  const approvedAt = new Date().toISOString();
  entry.referenceReviewStatus = REFERENCE_APPROVED;
  entry.referenceApproval = {
    status: REFERENCE_APPROVED,
    characterBibleId: entry.characterBible.id,
    reviewPath: entry.characterBible.referenceReviewPath,
    sha256: fileState.sha256,
    fileSizeBytes: fileState.fileSizeBytes,
    approvedAt,
  };
  if (!entry.job?.id && entry.status === REFERENCE_AWAITING) {
    entry.status = REFERENCE_APPROVED;
  }
  entry.executedStages = {
    ...(entry.executedStages || {}),
    referenceReviewApproved: true,
  };
  const allApproved = FIXTURES.every(({ key }) => (
    ledger.proofs[key]?.referenceReviewStatus === REFERENCE_APPROVED
  ));
  if (ledger.totalApprovedEstimate) {
    ledger.totalApprovedEstimate.status = allApproved
      ? "references-approved"
      : "awaiting-reference-review";
  }
  await writeLedger(ledger);
  process.stdout.write(`${descriptor.key}: approved review SHA-256 ${fileState.sha256}.\n`);
}

function accountExecutedAttempt(ledger, descriptor, entry, outcome, accountedAt) {
  if (!entry?.job?.id || entry.job.budgetAccountedAt) return;
  const upperUsd = Number(
    entry.job.estimatedMaxUsd ?? entry.estimate?.estimatedMaxUsd,
  );
  if (!Number.isFinite(upperUsd) || upperUsd < 0) {
    throw new Error(`${descriptor.key}: the executed job has no valid bounded upper estimate.`);
  }
  const budget = ledger.cumulativeProofBudget || {};
  const priorProjectUpperUsd = Number(
    budget.priorProjectBoundedUpperUsd ?? budget.priorBoundedUpperUsd ?? 0,
  );
  const campaign = budget.finalAttemptCampaign || {};
  const attempts = Array.isArray(campaign.executedAttempts)
    ? campaign.executedAttempts
    : [];
  if (!attempts.some((attempt) => attempt.jobId === entry.job.id)) {
    attempts.push({
      fixtureKey: descriptor.key,
      jobId: entry.job.id,
      outcome,
      upperUsd,
      accountedAt,
    });
  }
  const executedUpperUsd = Number(
    attempts.reduce((sum, attempt) => sum + Number(attempt.upperUsd || 0), 0).toFixed(2),
  );
  ledger.cumulativeProofBudget = {
    ...budget,
    proofCapUsd: MAX_COMBINED_APPROVED_USD,
    totalProjectCapUsd: MAX_TOTAL_PROJECT_TEST_USD,
    priorProjectBoundedUpperUsd: priorProjectUpperUsd,
    finalAttemptCampaign: {
      ...campaign,
      capUsd: MAX_COMBINED_APPROVED_USD,
      executedAttempts: attempts,
      executedUpperUsd,
    },
  };
  entry.job.budgetAccountedAt = accountedAt;
  entry.job.budgetUpperUsd = upperUsd;
}

async function reconcileLedgerJobs(ledger, { announce = true } = {}) {
  let changed = false;
  for (const descriptor of FIXTURES) {
    const entry = ledger.proofs[descriptor.key];
    if (!entry?.job?.id) continue;
    const response = await apiJson(`/api/v1/jobs/${encodeURIComponent(entry.job.id)}`);
    if (!response?.job) {
      throw new Error(`${descriptor.key}: the durable job response was incomplete.`);
    }
    const observedAt = new Date().toISOString();
    entry.job.status = response.job.status;
    entry.job.stage = response.job.stage;
    entry.job.lastObservedAt = observedAt;
    if (response.job.status === "failed") {
      entry.status = "failed-needs-safe-retry-review";
      entry.job.error = {
        code: response.job.error?.code || "GENERATION_FAILED",
        message: response.job.error?.message || "The durable job failed.",
      };
      entry.job.safeToRetry = entry.job.safeToRetry === true;
      accountExecutedAttempt(ledger, descriptor, entry, "failed", observedAt);
    } else if (response.job.status === "completed" && response.result?.story?.slug) {
      entry.status = entry.executedStages?.publicApproval === true
        ? "published"
        : "generated-pending-public-approval";
      entry.job.completedAt = response.job.updatedAt || observedAt;
      entry.result = {
        slug: response.result.story.slug,
        url: response.result.story.url,
        title: response.result.story.title,
        listing: response.result.story.listing,
      };
      entry.executedStages = {
        ...(entry.executedStages || {}),
        finalStory: true,
      };
      accountExecutedAttempt(ledger, descriptor, entry, "completed", observedAt);
    } else {
      entry.status = "running";
    }
    changed = true;
    if (announce) {
      process.stdout.write(`${entry.title || descriptor.key}: reconciled durable job as ${entry.status}.\n`);
    }
  }
  if (changed) await writeLedger(ledger);
  return { ledger, changed };
}

async function reconcile() {
  await reconcileLedgerJobs(await readLedger());
}

async function approveSafeRetry(targetKey) {
  const descriptor = FIXTURES.find((item) => item.key === targetKey);
  if (!descriptor) {
    throw new Error("approve-safe-retry requires exactly one known fixture key.");
  }
  const ledger = await readLedger();
  const entry = ledger.proofs[descriptor.key];
  if (
    !entry?.job?.id
    || entry.job.status !== "failed"
    || entry.status !== "failed-needs-safe-retry-review"
  ) {
    throw new Error(`${descriptor.key}: no reconciled failed job is awaiting safe-retry review.`);
  }
  const fileState = await inspectTrackedReviewFile(descriptor.key, entry, { includeHash: true });
  const disposition = approvedReferenceDisposition(entry, fileState);
  if (!disposition.allowed) {
    throw new Error(`${descriptor.key}: safe retry requires the exact approved reference (${disposition.reason}).`);
  }
  entry.job.safeToRetry = true;
  entry.job.safeRetryApprovedAt = new Date().toISOString();
  await writeLedger(ledger);
  process.stdout.write(`${descriptor.key}: one replacement attempt was explicitly approved.\n`);
}

async function pollJob(jobId, title) {
  const deadline = Date.now() + MAX_JOB_WAIT_MS;
  let previousStage = "";
  while (Date.now() < deadline) {
    const response = await apiJson(`/api/v1/jobs/${encodeURIComponent(jobId)}`);
    if (!response?.job) throw new Error(`${title}: the job response was incomplete.`);
    if (response.job.stage !== previousStage) {
      previousStage = response.job.stage;
      process.stdout.write(`${title}: ${previousStage}.\n`);
    }
    if (response.job.status === "completed" && response.result?.story?.slug) return response.result;
    if (response.job.status === "failed") {
      throw new Error(
        `${title}: ${response.job.error?.code || "GENERATION_FAILED"}: ${response.job.error?.message || "The job failed."}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`${title}: timed out while polling the protected loopback job.`);
}

async function removeUntrackedReviewFiles(ledger) {
  const tracked = new Set(
    Object.values(ledger.proofs)
      .map((entry) => entry?.characterBible?.referenceReviewPath)
      .filter(Boolean)
      .map((filename) => path.resolve(filename)),
  );
  let entries = [];
  try {
    entries = await fs.readdir(REVIEW_DIR, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const candidate = path.resolve(REVIEW_DIR, entry.name);
    if (
      entry.isFile()
      && /^[a-z0-9-]+-[0-9a-f-]{36}\.webp$/.test(entry.name)
      && !tracked.has(candidate)
      && path.dirname(candidate) === path.resolve(REVIEW_DIR)
    ) {
      await fs.rm(candidate, { force: true });
      process.stdout.write(`Removed untracked private review file ${entry.name}.\n`);
    }
  }
}

async function requireApprovedReferences(ledger) {
  for (const descriptor of FIXTURES) {
    const entry = ledger.proofs[descriptor.key];
    if (!entry?.characterBible?.id) {
      throw new Error(`${descriptor.key}: prepare and review a private reference before publishing.`);
    }
    if (new Date(entry.characterBible.expiresAt).getTime() <= Date.now()) {
      throw new Error(`${descriptor.key}: the approved reference expired; prepare and review a fresh guide.`);
    }
    const fileState = await inspectTrackedReviewFile(descriptor.key, entry, { includeHash: true });
    const disposition = approvedReferenceDisposition(entry, fileState);
    if (!disposition.allowed) {
      throw new Error(
        `${descriptor.key}: publish requires the exact deliberately approved reference file (${disposition.reason}). Run approve-reference after visual review.`,
      );
    }
  }
}

async function approvePublicStory(slug) {
  const { stdout } = await execFile(
    PLATFORM_NODE_BIN,
    [path.join(PROJECT_ROOT, "scripts/story-admin.mjs"), "approve", slug],
    {
      cwd: PROJECT_ROOT,
      timeout: 60_000,
      maxBuffer: 16 * 1024,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        STORYSCROLLS_DATA_DIR: "/Users/coryboehne/Server Hosting/_data/thestoryscrolls",
      },
    },
  );
  if (!stdout.includes(`${slug}: approved`)) {
    throw new Error(`${slug}: the admin publication command did not confirm approval.`);
  }
}

async function authorizeSafeRetries(estimated, ledger) {
  for (const item of estimated.values) {
    const entry = ledger.proofs[item.descriptor.key];
    if (!entry?.job?.id || entry.job.status !== "failed") continue;
    if (entry.job.safeToRetry !== true) {
      throw new Error(`${item.fixture.title}: the failed production job requires explicit approve-safe-retry review.`);
    }
    entry.jobHistory = [
      ...(Array.isArray(entry.jobHistory) ? entry.jobHistory : []),
      {
        id: entry.job.id,
        status: "failed",
        stage: entry.job.stage,
        errorCode: entry.job.error?.code || "GENERATION_FAILED",
        budgetUpperUsd: entry.job.budgetUpperUsd,
        budgetAccountedAt: entry.job.budgetAccountedAt,
        retiredAt: new Date().toISOString(),
      },
    ];
    entry.job = null;
    entry.idempotencyKey = crypto.randomUUID();
    entry.status = REFERENCE_APPROVED;
    await writeLedger(ledger);
  }
}

async function stageAllGeneratedStories(estimated, ledger) {
  for (const item of estimated.values) {
    const entry = ledger.proofs[item.descriptor.key];
    if (entry.executedStages?.finalStory === true && entry.result?.slug) continue;
    let jobId = entry.job?.id || null;
    if (!jobId) {
      let apiKey = await readApiKey();
      try {
        const approvedBible = await apiJson(
          `/api/v1/character-bibles/${encodeURIComponent(entry.characterBible.id)}/approve`,
          { method: "POST", body: { approved: true }, timeoutMs: 60_000 },
        );
        if (!approvedBible?.approval?.token) {
          throw new Error(`${item.fixture.title}: character-reference approval was incomplete.`);
        }
        const body = structuredClone(item.fixture);
        body.generation.estimateApproval = item.response.approval;
        body.generation.characterBibleApproval = approvedBible.approval;
        process.stdout.write(`${item.fixture.title}: submitting one idempotent async production job…\n`);
        const accepted = await apiJson("/api/v1/stories", {
          method: "POST",
          body,
          apiKey,
          idempotencyKey: entry.idempotencyKey,
          timeoutMs: 90_000,
          retryNetworkOnce: true,
        });
        if (!accepted?.job?.id) {
          throw new Error(`${item.fixture.title}: the async API did not return a durable job ID.`);
        }
        entry.status = "running";
        entry.job = {
          id: accepted.job.id,
          status: accepted.job.status,
          stage: accepted.job.stage,
          submittedAt: new Date().toISOString(),
          safeToRetry: false,
          estimatedMaxUsd: item.response.estimate.estimatedMaxUsd,
        };
        entry.estimate = safeEstimate(item.response.estimate);
        await writeLedger(ledger);
        jobId = accepted.job.id;
      } finally {
        apiKey = null;
      }
    }
    const result = await pollJob(jobId, item.fixture.title);
    entry.status = "generated-pending-public-approval";
    entry.job.stage = "completed";
    entry.job.completedAt = new Date().toISOString();
    entry.result = {
      slug: result.story.slug,
      url: result.story.url,
      title: result.story.title,
      listing: result.story.listing,
    };
    entry.executedStages.finalStory = true;
    await writeLedger(ledger);
  }
  for (const item of estimated.values) {
    const entry = ledger.proofs[item.descriptor.key];
    accountExecutedAttempt(ledger, item.descriptor, entry, "completed", new Date().toISOString());
  }
  const budget = ledger.cumulativeProofBudget;
  if (budget?.finalAttemptCampaign) {
    budget.finalAttemptCampaign.pendingPairUpperUsd = 0;
    budget.finalAttemptCampaign.projectedCampaignUpperUsd =
      budget.finalAttemptCampaign.executedUpperUsd;
    budget.overallProjectedUpperUsd = Number((
      Number(budget.priorProjectBoundedUpperUsd || 0)
      + Number(budget.finalAttemptCampaign.executedUpperUsd || 0)
    ).toFixed(2));
    budget.cumulativeUpperUsd = budget.overallProjectedUpperUsd;
  }
  if (ledger.totalApprovedEstimate) {
    ledger.totalApprovedEstimate.status = "generated-pending-public-approval";
  }
  await writeLedger(ledger);
}

async function approveAllStagedStories(estimated, ledger) {
  for (const item of estimated.values) {
    const entry = ledger.proofs[item.descriptor.key];
    if (entry.executedStages?.finalStory !== true || !entry.result?.slug) {
      throw new Error("PUBLICATION_GATE: both proof stories must be fully staged before either is made public.");
    }
  }
  for (const item of estimated.values) {
    const entry = ledger.proofs[item.descriptor.key];
    if (entry.executedStages?.publicApproval === true && entry.status === "published") continue;
    await approvePublicStory(entry.result.slug);
    entry.status = "published";
    entry.result.listing = {
      requested: true,
      status: "approved",
      visibility: "public",
    };
    entry.executedStages.publicApproval = true;
    await writeLedger(ledger);
    process.stdout.write(`${entry.result.title}: published at ${entry.result.url}.\n`);
  }
}

async function publish() {
  const ledger = await readLedger();
  await requireApprovedReferences(ledger);
  const estimated = await estimateFixtures();
  const pendingMaximum = Number(estimated.values.reduce((sum, item) => {
    const entry = ledger.proofs[item.descriptor.key];
    return sum + (entry?.executedStages?.finalStory === true
      ? 0
      : Number(item.response.estimate.estimatedMaxUsd));
  }, 0).toFixed(2));
  const budget = ledger.cumulativeProofBudget || {};
  const priorProjectUpperUsd = Number(
    budget.priorProjectBoundedUpperUsd ?? budget.priorBoundedUpperUsd ?? 0,
  );
  const campaignExecutedUpperUsd = Number(
    budget.finalAttemptCampaign?.executedUpperUsd ?? 0,
  );
  const decision = evaluateProofBudget({
    pairUpperUsd: pendingMaximum,
    priorProjectUpperUsd,
    campaignExecutedUpperUsd,
    proofCapUsd: MAX_COMBINED_APPROVED_USD,
    totalProjectCapUsd: MAX_TOTAL_PROJECT_TEST_USD,
  });
  const budgetOverride = validBudgetOverride(ledger.budgetOverride);
  const overrideApplied = !decision.allowed
    && budgetOverride
    && ["proof-cap", "project-cap"].includes(decision.reason);
  if (!decision.allowed && !overrideApplied) {
    throw new Error(
      `BUDGET_GATE: pending pair ${pendingMaximum.toFixed(2)}, final campaign ${decision.campaignUpperUsd?.toFixed(2) || "invalid"}, overall ${decision.overallUpperUsd?.toFixed(2) || "invalid"} (${decision.reason}). No provider work was started.`,
    );
  }
  if (overrideApplied) {
    process.stderr.write(
      `BUDGET_OVERRIDE: user-authorized budget-only override is active; projected final campaign $${decision.campaignUpperUsd?.toFixed(2) || "invalid"}, overall $${decision.overallUpperUsd?.toFixed(2) || "invalid"}. Reference, hash, lock, retry, and two-story staging gates remain mandatory.\n`,
    );
  }
  process.stdout.write(
    `Budget gate revalidated: pending pair $${pendingMaximum.toFixed(2)}, final campaign $${decision.campaignUpperUsd.toFixed(2)} of $${MAX_COMBINED_APPROVED_USD.toFixed(2)}, overall $${decision.overallUpperUsd.toFixed(2)} of $${MAX_TOTAL_PROJECT_TEST_USD.toFixed(2)}.\n`,
  );
  ledger.cumulativeProofBudget = {
    ...budget,
    proofCapUsd: MAX_COMBINED_APPROVED_USD,
    totalProjectCapUsd: MAX_TOTAL_PROJECT_TEST_USD,
    priorProjectBoundedUpperUsd: priorProjectUpperUsd,
    nextPairUpperUsd: pendingMaximum,
    finalAttemptCampaign: {
      ...(budget.finalAttemptCampaign || {}),
      capUsd: MAX_COMBINED_APPROVED_USD,
      executedAttempts: budget.finalAttemptCampaign?.executedAttempts || [],
      executedUpperUsd: campaignExecutedUpperUsd,
      pendingPairUpperUsd: pendingMaximum,
      projectedCampaignUpperUsd: decision.campaignUpperUsd,
    },
    overallProjectedUpperUsd: decision.overallUpperUsd,
    cumulativeUpperUsd: decision.overallUpperUsd,
    status: decision.allowed
      ? "approved-for-bounded-final-pair"
      : "user-authorized-budget-override",
  };
  await writeLedger(ledger);
  await removeUntrackedReviewFiles(ledger);
  await authorizeSafeRetries(estimated, ledger);
  await stageAllGeneratedStories(estimated, ledger);
  await approveAllStagedStories(estimated, ledger);
  ledger.totalApprovedEstimate.status = "completed-and-published";
  ledger.totalApprovedEstimate.completedAt = new Date().toISOString();
  await writeLedger(ledger);
}

const command = process.argv[2];
const validCommands = new Set([
  "prepare",
  "approve-reference",
  "approve-safe-retry",
  "reconcile",
  "publish",
  "cleanup",
]);

async function main() {
  if (!validCommands.has(command)) {
    throw new Error(
      "Usage: node run-live-proofs.mjs <prepare [fixture-key]|approve-reference fixture-key|approve-safe-retry fixture-key|reconcile|publish|cleanup>",
    );
  }
  const releaseLock = await acquireExclusiveLock(command);
  try {
    if (!["reconcile", "cleanup"].includes(command)) {
      await reconcileLedgerJobs(await readLedger());
    }
    if (command === "prepare") await prepare(process.argv[3] || null);
    else if (command === "approve-reference") await approveReference(process.argv[3] || null);
    else if (command === "approve-safe-retry") await approveSafeRetry(process.argv[3] || null);
    else if (command === "reconcile") await reconcile();
    else if (command === "publish") await publish();
    else if (command === "cleanup") await removeUntrackedReviewFiles(await readLedger());
  } catch (error) {
    if (command === "publish") {
      try {
        await reconcileLedgerJobs(await readLedger());
      } catch (reconcileError) {
        process.stderr.write(
          `RECONCILE_WARNING: ${safeMessage(reconcileError)} The next locked command will reconcile again before doing work.\n`,
        );
      }
    }
    throw error;
  } finally {
    await releaseLock();
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${safeMessage(error)}\n`);
  process.exitCode = 1;
}
