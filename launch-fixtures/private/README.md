# Private launch fixtures

These are nonpublic, nonsecret request templates for the first two end-to-end
launch checks. They contain no OpenAI key, estimate-approval token, generated
text, or generated image.

Before either request can enter paid production:

1. Validate it through `POST /api/v1/estimates` as the intended signed-in owner.
2. Present the returned minimum/maximum range and current pricing disclaimer.
3. Obtain explicit user approval.
4. Add that same response's owner-bound `approval` object to
   `generation.estimateApproval` only in the in-memory production request.
5. Complete and approve the character-reference checkpoint before final image
   production.

Do not commit an approval token to these files. A changed request requires a
fresh estimate and approval.

The latest zero-OpenAI-call validation result is recorded in
`estimates.2026-07-21.json`. Re-estimate both fixtures whenever request content,
quality settings, provider pricing, or estimator logic changes.

`run-live-proofs.mjs` is a private, loopback-only, checkpointed launch runner.
Every command holds one exclusive local process lock. A live owner is never
displaced; a dead or safely aged incomplete lock can be quarantined and removed.
The adjacent budget ledger stores no key, bearer header, or approval token.

The deliberate workflow is:

1. `node run-live-proofs.mjs prepare [fixture-key]` creates only missing,
   expired, or explicitly rejected review references. It reuses a valid pending
   reference and refuses to reset approved, running, completed, or published
   state.
2. Review each tracked WebP, then run
   `node run-live-proofs.mjs approve-reference fixture-key`. Approval records the
   exact file path, byte size, SHA-256, character-guide ID, and approval time.
   Run it once for each fixture. A changed, missing, replaced, or expired file
   fails closed.
3. `node run-live-proofs.mjs publish` reconciles durable job state, requires both
   exact approved files, re-estimates, and enforces two separate limits: all
   executed and pending attempts in the final proof campaign must remain within
   $12, and the prior testing bound plus that campaign must remain within $25.
   Executed attempt bounds and the pending pair are recorded separately.
4. Both generated stories are staged successfully before either local public
   approval runs. Review files remain private and tracked so a resume can
   revalidate their hashes.

`node run-live-proofs.mjs reconcile` copies durable local job truth into the
ledger without making provider requests. All stateful commands do this at
startup as well. A failed job remains `safeToRetry: false`; after reviewing the
failure and the still-approved reference, one replacement attempt must be
deliberately authorized with
`node run-live-proofs.mjs approve-safe-retry fixture-key`. Idempotency keys are
rotated only after that authorization. `cleanup` removes only untracked private
review files.

For this contest release only, the ledger contains the user's explicit
2026-07-21 authorization to continue when either test-cost projection is over
its cap because release reliability was prioritized. The runner records and
prints the overage loudly. This narrowly scoped persisted override satisfies
only the budget gate; it cannot bypass reference approval or hash matching, the
exclusive lock, explicit safe-retry review, durable reconciliation, or the rule
that both stories must be staged before public approval.
