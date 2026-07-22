# TheStoryScrolls.com workspace boundary

This repository is the post-contest development workspace for
`https://thestoryscrolls.com`. It is **not** the OpenAI Build Week submission
deployment.

## Never modify the frozen submission

No task performed from this workspace may edit, rebuild, retag, redeploy,
restart, copy over, or otherwise mutate any of these submission resources:

- `https://googledevweekjul.corydev.com`
- `/Users/coryboehne/Server Hosting/sites/storyscrolls-googledevweekjul-frozen`
- `/Users/coryboehne/Server Hosting/_data/storyscrolls-googledevweekjul-frozen`
- `/Users/coryboehne/Server Hosting/_data/storyscrolls-googledevweekjul-immutable-baseline-20260721`
- launch service `com.corydev.googledevweekjul-storyscrolls-platform`
- Keychain service `com.corydev.googledevweekjul-storyscrolls.session-secret`
- Caddy matcher/import `googledevweekjul_storyscrolls_*`
- Git tag `googledevweekjul-submission-illuminated-20260721` and every earlier
  `googledevweekjul-*` tag

Those resources are evidence artifacts. Never remove immutable flags or move a
submission tag as part of ordinary development. If a future user explicitly
requests archival recovery, first state exactly which protected resource would
change and obtain confirmation.

## Live-development rules

- Work on `post-contest` or a feature branch, never on a submission tag.
- Use this checkout, its own build output, and the existing non-submission data
  directory only. Never share a source root, build root, service label, port,
  secret, or SQLite file with the judging deployment.
- Preserve user changes and unrelated dirty files.
- Build and test before switching `thestoryscrolls.com` to a new commit.
- Back up the live SQLite database with its online backup operation before a
  schema migration or deployment that can write data.
- Keep API keys and session/OAuth secrets in Keychain or transient memory; do
  not commit them or persist user API keys.
- Keep generated illuminated initials derivative-only. Never publish or expose
  enumerable source alphabets.

