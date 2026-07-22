# TheStoryScrolls.com post-contest work plan

This checkout is the forward-moving product. The judging build is a separate,
immutable deployment and is intentionally absent from this plan.

## 1. Stabilize the inherited working changes

- Verify the mobile title-page spacing and reader-facing author-name cleanup.
- Validate upload moderation tests and the production Keychain bootstrap fix.
- Decide when Google authentication is ready; do not enable it until OAuth
  credentials, callback handling, sign-out, and failure recovery are tested.

## 2. Qualify this checkout as the live release source

- Install from the committed lockfile, run the complete build and focused
  platform tests, then record the candidate commit.
- Update the non-submission launch definition and Caddy roots to this checkout.
- Back up `/Users/coryboehne/Server Hosting/_data/thestoryscrolls` with SQLite's
  online backup operation before switching the live service.
- Smoke-test home, catalog, creator, community, representative books, public
  generated scrolls, media delivery, a real 404, and `/health` before and after
  the switch.

## 3. Finish the creator as a dependable product

- Keep source selection friendly: upload, public-domain catalog, or original AI
  story, with automatic scope defaults and optional expert overrides.
- Keep hard-spend-cap intervention resumable: raise the cap, reduce quality,
  reduce art, or publish the best coherent partial result.
- Preserve layered/chunked writing, character continuity, age/content
  adaptation, summarization, provenance, and cost disclosures.
- Verify that every generated scroll materializes the selected illuminated set
  and only falls back when derivative generation genuinely fails.

## 4. Community, search, and trust

- Complete Google sign-in and subscription/quota enforcement after the public
  no-auth competition configuration is no longer relevant.
- Keep UGC indexed by title, source family, creator, language, target age,
  reading depth, transformation, format, and quality.
- Offer existing versions before duplicating a source work.
- Retain moderation, reporting, rights/provenance records, and age-suitable text
  and illustration review.

## 5. Illuminated Fonts partnership

- Continue the daily catalog sync from the authoritative manifest.
- Preserve the current 233-set selector and story-specific curated mappings.
- Show protected previews while delivering only the initials actually used by
  each scroll.

