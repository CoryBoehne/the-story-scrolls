# The Story Scrolls platform architecture

## Product surfaces

| Surface | Route | Content trust | Opening |
| --- | --- | --- | --- |
| Main library | `/` | first-party curation | replaceable scrollytelling stub |
| Featured stories | `/stories/<slug>/` | reviewed adapter + provenance lock | bespoke story scrollytelling |
| Community library | `/community/` | approved community revisions only | collection view |
| Shared story | `/shared/<slug>/` | moderated, public or unlisted | standard text-first intro; interior art follows creator policy |
| Creator | `/create/` | private draft input | authoring workflow |
| About, rights & provenance | `/about/` | first-party policy | editorial page |

The main and featured openings implement the same reduced-motion and keyboard
escape hatches as the readers. The main opening is intentionally a stub whose
visual assets and copy can be replaced without changing routing or library
content. Featured intros are deliberately hand-authored. The standard community
intro is data-driven and does not pretend to be a bespoke cinematic sequence.

## Illuminated Letters catalog boundary

The canonical Illuminated Letters manifest is synced once a day into
`/Users/coryboehne/Server Hosting/_data/thestoryscrolls/illuminated-catalog/current/`
with an atomic directory swap. Story Scrolls accepts only complete 36-character
sets and checksums every downloaded preview. The cache is deliberately outside
the static web root.

The authenticated creator API exposes a sanitized set list at
`/api/v2/illuminated-sets` and a same-origin preview endpoint at
`/api/v2/illuminated-sets/<slug>/preview`. Public metadata does not contain raw
glyph records, source hashes, filesystem paths, derivative origins, originals,
or archives. Preview responses are integrity-checked watermarked derivatives.
Browser-visible pixels cannot be made uncopyable, so the product says so
plainly: the selector is a deterrent and discovery surface, not DRM. Catalog
terms are not published and selecting a preview does not grant production-use
rights; a separate rights record is required.

## Story adapter boundary

Every source adapter resolves a descriptor with a stable story ID, catalog,
safe block AST, art manifest, provenance, credits, theme, and intro mode. Source
quirks stay inside that adapter. Public-domain adapters preserve authored
brackets, poems, indentation, and illustrations; transformation rules are
explicitly scoped to the source or project that requested them.

Community and curated stories render only semantic blocks such as paragraphs,
verse, headings, dividers, and credited images. Raw community HTML is never
rendered.

## Curated registry and rights boundary

The two original Alice/Oz adapters remain specialized legacy builders. The 22
newer editions are declared in `config/curated-books.json` and processed by the
registry builder. A registry entry pins the text edition and parser contract;
optional `artEbookId` and `artSourceUrl` fields pin a different historic edition
when its illustrations are paired with the complete text. Generated asset
records keep that source distinction and file-level attribution intact.

Registry books refer to shared illuminated alphabets by `illuminatedSet`. Each
of the six referenced sets is optimized once under
`public/assets/curated-illuminated/<set>/`, with a checksum manifest, and may be
used by several stories. This is presentation data, not a substitute for the
edition's credited original illustrations.

Rights are release metadata, not an inference made by the reader. Every entry
declares either `life-plus-70-clear` or `united-states-only`, with a specific
jurisdiction note copied into the generated story snapshot. A passing build
confirms registry shape, provenance, and asset integrity; it does not broaden
the declared territorial rights scope.

## Community state model

`draft -> generating -> moderated -> unlisted`

`unlisted -> review_requested -> listed | rejected`

Prohibited material is rejected before a durable story revision is committed.
An unlisted URL is shareable but excluded from the community shelf and search
index. Public listing always requires the separate approved state. Reports
unlist suspicious content for review; they do not destroy it automatically.

The SQLite schema separates normalized story packages, media, moderation
events, and reports. Its story and asset IDs are stable, leaving clean seams for
immutable revision and asynchronous-job tables when editing or long-running
imports are introduced. Generated media uses opaque database IDs and content
hashes in a private directory. The API serves only accepted database-known
media; Caddy never exposes the private data root.

Community creators must choose one explicit interior-art policy:

- `none`: no uploaded media and zero image-generation calls;
- `ai`: one 1344×576 chapter-opening hero per chapter, plus a bounded inline
  density. `light` has no inline scenes, `balanced` has one per chapter, and
  `rich` has `min(3, max(1, ceil(targetWordsPerChapter / 750)))` per chapter; or
- `upload`: 1–12 creator-supplied still images with an artwork-rights
  confirmation and public credit.

The request-specific structured-output schema requires exactly one hero plan
for every chapter and the exact density-derived number of inline plans in every
chapter. Inline plans carry exact chapter/block anchors; heroes are inserted as
the first AST block with `placement: "chapter-hero"` and `align: "hero"`. The
server first makes one private, square style-and-character continuity sheet
with `gpt-image-2`, then supplies that same sheet to every displayed low-quality
image request through the image edits endpoint. The sheet is moderated but
never committed or served. Heroes are exactly 1344×576. Inline scenes use
minimum-size 640×1024 portrait or 1024×640 landscape outputs. All displayed
images are stored as WebP under the common `illustration` asset role, with a
persisted `chapter-hero` or `inline` placement kind. The selected visual family,
book-specific visual bible, character references, density, model, quality, and
hero/inline counts are retained as story policy metadata so a single book
remains coherent without imposing one look across the library.

Uploaded inline illustrations use this placement label:

`NNN__chCC-pctPPP-ALIGN__ALT.ext`

For example, `001__ch01-pct025-right__a-lantern-in-the-rain.jpg` places the
first ordered image one quarter through chapter 1, aligned right. `PPP` is one
of `000`, `025`, `050`, `075`, or `100`; `ALIGN` is `left`, `right`, or
`plate`. An optional uploaded chapter hero instead uses
`NNN__chCC-hero__ALT.ext`, for example
`002__ch02-hero__the-garden-at-dawn.webp`. Uploaded-art mode does not require a
hero for every chapter, but it permits at most one per chapter. In both forms,
the lowercase `ALT` slug becomes accessible alt text and `NNN` fixes tie order.
Placement is resolved only after the final chapter AST exists. Uploaded paths
are never derived from this name: accepted JPEG, PNG, and WebP files are decoded
with a 24-megapixel ceiling, stripped of metadata, bounded to 1600 pixels,
converted to WebP, and stored under opaque UUID filenames. Limits are 12 files,
6 MiB per file, 40 MiB aggregate file bytes, and 50 MiB for the complete
multipart body.

## BYOK generation boundary

The browser sends the creator's OpenAI key to the same-origin API over TLS for
one synchronous generation request. It is kept only in process memory and
forwarded only to hardcoded official OpenAI API endpoints. It is not retained
across a restart; a failed or interrupted request simply asks the creator to
enter it again. The browser clears the key field immediately after copying the
value into request-local memory. The server admits at most two creation
requests at once and performs text moderation, which also authenticates the
key, before decoding uploaded image pixels.

The server, not the user, controls model choice, schemas, safety prompts, token
and image budgets, reference-image handling, and the destination host. User controls are a bounded policy
object: title and attribution, text/source input, illumination theme,
illustration density, and narrowly defined leading-note envelopes. Arbitrary
regular expressions, JavaScript, system prompts, model names, and API base URLs
are not accepted.

Creation requires:

1. original/public-domain/licensed rights attestation and source metadata;
2. input and prompt moderation;
3. strict structured story output;
4. optional generated or uploaded interior art that matches the explicit policy;
5. output moderation and media validation when art is present;
6. a two-phase database/media commit (with no media directory for text-only stories).

An optional `generation.spendCapUsd` adds a best-effort admission guard. Before
creating a durable job or calling OpenAI, the server resolves the submitted
source, recomputes the conservative estimate, validates the signed estimate,
and rejects plans whose estimated maximum is above the cap. The same comparison
is repeated inside the job immediately before provider work. This is preflight
planning—not provider billing telemetry—so actual token accounting, retries,
reference-image input, and later price changes can differ. Provider account
spend controls remain required. The response offers only an increased cap or a
smaller quality/art plan at this boundary; “finish as-is” is unavailable because
no coherent minimum has been generated yet.

Paid illustration work is queued by narrative utility: cover, one chapter hero
per chapter, one inline scene per chapter, then optional enrichment. Story and
media publication is still atomic. A failed/interrupted job never publishes an
incomplete book, even if some unpublished assets were already generated.

On startup, the single service owner removes UUID-scoped incomplete staging
directories. Any finalized UUID media directory that has no `story_assets`
record is moved into the private `.orphaned-media` quarantine instead of being
deleted. This reconciles crashes between the media rename and SQLite commit
while preserving unexpected final media for operator recovery.

Ordinary fantasy violence, horror, romance, and profanity are permitted.
Explicit pornography, any sexual content involving minors, non-consensual
sexual material, doxxing, extremist recruitment, exploitative illegal content,
and malware are rejected. Ambiguous or unusually graphic content is kept out of
the public shelf and routed to review rather than being silently erased.

## Durable storage and operations

- Static curated snapshots: `public/stories/<slug>/`
- Curated registry: `config/curated-books.json`
- Shared illuminated sets: `public/assets/curated-illuminated/<set>/`
- Community SQLite/media: `/Users/coryboehne/Server Hosting/_data/thestoryscrolls/`
- Recoverable orphan-media quarantine: `.orphaned-media/` within that private data root
- API listener: `127.0.0.1:4305`
- Existing reference catalog: `127.0.0.1:4302`

SQLite uses WAL mode, foreign keys, a busy timeout, and explicit migrations.
Backups copy a consistent SQLite snapshot plus media, then verify database
integrity and file hashes. Curated source refresh is an explicit build step, not
a reader-time scrape. A future object-store/database migration can replace the
community repository without changing the story AST or public route contract.

## Security invariants

- No OpenAI key in storage, cookies, logs, telemetry, errors, or responses.
- Loopback-only API listener; same-origin browser access through Caddy.
- Exact Origin checks, body/file/pixel and rate limits, restrictive CORS, safe
  JSON, and streaming multipart parsing.
- No raw community HTML and no public filesystem path derived from user input.
- No arbitrary remote fetch in the initial release. New repository adapters are
  allowlisted and reviewed before deployment.
- Stable story IDs and revision hashes; story-scoped reading-position keys.
- Every curated image has creator, source, rights, and checksum metadata.
