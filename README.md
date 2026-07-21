# The Story Scrolls

The Story Scrolls turns carefully sourced stories into continuous, illustrated
reading experiences. The public site at `thestoryscrolls.com` contains a curated
featured library, a separate community collection, and an authoring flow that
uses each creator's own OpenAI API key. This is the clean public fork; the legacy
`storyscrolls.corydev.com` deployment is a separate project and is not served
from this repository.

The curated public-domain collection has two build lanes. The original legacy
builder remains responsible for *Alice's Adventures in Wonderland* (Project
Gutenberg eBook 11 with the 42 John Tenniel illustrations from eBook 114) and
*The Wonderful Wizard of Oz* (eBook 43936 with its interleaved W. W. Denslow
illustrations). A registry-driven builder adds 22 more reviewed editions from
[`config/curated-books.json`](config/curated-books.json). That registry is the
source of truth for each new book's slug, edition, parsing rules, illustration
budget, illuminated-letter set, and rights scope.

Curated editions are deterministic local snapshots. Their normalized content,
optimized illustrations, exact input checksums, edition metadata, rights
records, and source links live together under `public/stories/`. Project
Gutenberg boilerplate is excluded from the reading body. Each featured book has
an authored, story-specific scrollytelling opening. Community stories instead
use a polished standard opening assembled from their generated cover and scene
plates.

Most registry entries use one Project Gutenberg edition for both text and art.
When the best complete text and the correct historic illustrations come from
different editions, `artEbookId` and `artSourceUrl` identify the separate art
source; each optimized image retains its own source eBook ID and attribution.
The `illuminatedSet` field points to one of six shared alphabets built once under
`public/assets/curated-illuminated/`, rather than copying a full alphabet into
every story. `rightsScope` is explicit per edition: `life-plus-70-clear` for the
19 broadly cleared entries and `united-states-only` for the three illustrated
editions that require geographic caution. The complete jurisdiction note is
preserved in each generated `story.json`.

## OpenAI Build Week judging build

The frozen judging deployment is available at
[`googledevweekjul.corydev.com`](https://googledevweekjul.corydev.com). It is a
free, no-login competition snapshot; Story Studio uses the visitor's own OpenAI
API key transiently and never stores it. The intended category is **Education**:
the product helps readers rediscover literature and teaches story structure,
character arcs, audience adaptation, visual direction, and cost/quality
tradeoffs while they create.

This project existed as an experimental scrollytelling reader before the July
13, 2026 submission period. During Build Week it was meaningfully extended into
a general-purpose creation platform: arbitrary public-domain catalog import,
rights-aware uploads, original-story coaching, GPT-5.6 quality tiers,
summarization and age adaptation, continuity-reference approval, generated
illustration pipelines, community indexing/search, transient BYOK security,
cost estimation and user spend caps, moderation, durable async jobs, and the
two-story live proof harness. The judging tag and dated commit are the canonical
record of that new work.

### How Codex and GPT-5.6 were used

Codex was the primary engineering collaborator throughout Build Week. It helped
turn product direction into the React authoring flow, responsive reader,
Node/SQLite service, Caddy deployment, source-mirror policy, security controls,
test suite, and release runbooks. It also created and validated complete themed
illuminated-letter alphabets, performed repeated desktop/mobile visual QA, and
diagnosed real provider failures through a privacy-safe live proof harness.

The human product decisions remained deliberate: the endless parchment reading
metaphor; strict public-domain/rights boundaries; age-appropriate content and
art direction; minimum illustration contracts; reference-sheet approval before
bulk art; no server-side API-key retention; and the balance between literary
quality, accessibility, cost, and speed. GPT-5.6 powers layered story planning,
adaptation, continuity-aware prose, and structured illustration direction. GPT
Image 2 renders continuity-guided art. Every generated scroll records its
source, creator, transformations, model/quality choices, and safety provenance.

For judges: open the frozen URL, browse a featured scroll, then choose **Create
a Scroll**. A public-domain title can be selected without a rights attestation;
uploads require one. The Review step displays the conservative estimate and a
best-effort local spend cap before any paid request. A working OpenAI API key is
required only to run new generation; the curated library and published proof
scrolls require no credentials. The demo is supported on current desktop and
mobile browsers.

## Architecture

The production shape deliberately separates the three trust levels:

- Static library and curated readers: exported by Vinext to `dist/client` and
  served directly by Caddy.
- Community creation and sharing: an isolated loopback service on
  `127.0.0.1:4307`, backed by SQLite and a private media directory outside the
  public web root.

The community service accepts an OpenAI key only for the duration of one
generation request. The key is never written to browser storage, cookies,
SQLite, the filesystem, logs, errors, or API responses. The service uses a
server-owned structured-output prompt, a fixed model allowlist, moderation,
bounded transformation settings, and an explicit interior-art policy. Creators
may choose no images; low-quality GPT Image 2 chapter heroes plus a bounded
per-chapter inline density, all derived from one private style-and-character
continuity reference; or a safely normalized image set whose filenames guide
chapter-hero and inline placement. A creator may request an unlisted share URL
after a successful safety pass. Appearance in the public community shelf is a
separate approval state.

See [docs/architecture.md](docs/architecture.md) for the data model, safety
boundaries, route contract, and future migration seams.

## Local development

Requirements: Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

Useful commands:

- `npm run build` — create the static export in `dist/client`.
- `npm test` — build and run static, provenance, and community-service tests.
- `npm run sitemap:build` — deterministically regenerate `public/sitemap.xml`
  from fixed product routes plus every entry in the curated registry. It also
  runs automatically before `npm run build`.
- `npm run curated:legacy:build` — rebuild the pinned Alice/Oz snapshots with
  their original specialized adapter and optimizer.
- `npm run curated:library:build` — ingest and optimize all 22 registry-driven
  editions, including their six shared illuminated-letter sets.
- `npm run curated:build` — run the legacy and registry pipelines in sequence,
  stopping immediately if either ingestion or optimization step fails.
- `PORT=4307 npm run platform:start` — run the public-fork community API on its
  isolated loopback port.
- `node scripts/plan-ai-chapter-illustrations.mjs` — rebuild the tracked curated
  chapter-art plans and ignored GPT Image 2 prompt queue without reading an API
  key or making API calls.
- `npm run ai-illustrations:package` — validate and package the complete curated
  chapter heroes and inline scenes into content-addressed schema-v2 sidecars.
- `npm run illuminated:sync` — atomically refresh the canonical Illuminated
  Letters manifest and its watermarked preview derivatives into the private
  Story Scrolls cache. It never imports archives, originals, or raw glyph paths.
- `npm run illuminated:agent:check` — validate the daily 03:45 catalog-refresh
  LaunchAgent without changing the host.
- `npm run illuminated:agent:install` — install, bootstrap, and immediately
  start that LaunchAgent for the current macOS user. Run this during release
  setup, then verify it with `launchctl print
  gui/$(id -u)/com.corydev.thestoryscrolls-illuminated-catalog`.

Curated rebuilds are explicit release operations, not normal dev-server setup.
Both lanes fetch their pinned source editions into private `.cache/` directories;
the legacy adapter also accepts explicit Alice/Oz HTML paths for offline release
work. Both optimizers read the private source alphabets from the sibling
`_private/illuminatedletters` collection. After a registry or route change, run
`npm run sitemap:build`, then `npm test`; production smoke checks should confirm
a legacy reader, a registry reader, the sitemap's last registry route, both
rights scopes, and a shared illuminated-set manifest.

Production operations, launch-agent details, Caddy routes, smoke checks, and
backup paths are documented in the shared server runbook.
