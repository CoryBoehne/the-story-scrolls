# Interior AI illustration art direction

The curated library uses OpenAI GPT Image 2 at low quality and minimum supported dimensions. These assets are interior moments only: no generated image in this catalog is a cover or intro frame.

`config/ai-illustrations.json` defines the approved catalog and each title's medium, palette, and compositional language, so books remain visually distinct. The tracked chapter plans bind that direction to exact story passages and content hashes.

All 24 books have a private continuity image in `output/imagegen/references/`. Those sheets establish recurring faces, proportions, clothing, props, and palette. Each displayed scene is created as an image edit with its book's sheet as the supplied reference. The sheets are production inputs only and are never copied into `public/`.

Run `node scripts/package-ai-illustrations.mjs` from the project root after all planned images are present. The packager verifies the exact 747-hero and 1,089-inline collection across all 24 approved public books, prompt and story hashes, WebP dimensions, and the GPT Image 2 pixel floor. It then copies content-hashed files to `public/stories/<slug>/ai-images/` and writes schema-v2 sidecar manifests. Curated `story.json` files are intentionally left untouched so the existing public-domain provenance pipeline can continue regenerating them safely.

The generation key is never stored here. Tracked plans preserve prompt hashes and deterministically reproduce the ignored prompt files. Source/reference images stay in the local ignored `output/` production workspace, while only approved displayed assets are published.

## Chapter-rich expansion plans

Run `node scripts/plan-ai-chapter-illustrations.mjs` to rebuild the deterministic expansion plan. It writes one tracked plan per book to `art-direction/ai-illustrations/chapter-plans/`, and writes the ignored generation prompts plus `chapter-illustration-jobs.tsv` under `output/imagegen/`. The planner does not read an API key or generate images.

Every chapter receives an additional 1344×576 (21:9) hero. The planner prefers an establishing beat near 10% of its narrative, falls back to a closing beat near 90% when needed, and aims to keep at least 15 cumulative-word percentage points between the hero source and every inline anchor. Its inline target is `min(4, max(1, ceil(narrativeWords / 3000), ceil(textBlocks / 100)))`, where visible paragraph and verse blocks are counted once. Approved scenes retain their exact anchors and count toward that target. Missing inline scenes are 1024×640 and are assigned unique paragraph/verse anchors nearest evenly spaced cumulative-word targets. Books without an approved continuity sheet receive a prerequisite 816×816 reference-sheet edit job seeded from that book's first approved scene.
