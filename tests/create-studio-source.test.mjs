import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const studioUrl = new URL("../app/platform/create-studio.tsx", import.meta.url);

test("creator studio gates creation behind a secure account while keeping BYOK transient", async () => {
  const source = await readFile(studioUrl, "utf8");

  assert.match(source, /fetch\("\/api\/v2\/auth\/me"/);
  assert.match(source, /NEXT_PUBLIC_CREATOR_AUTH_REQUIRED === "true"/);
  assert.match(source, /CREATOR_AUTH_REQUIRED && \(authState/);
  assert.match(source, /credentials: "same-origin"/);
  assert.match(source, /Continue with Google/);
  assert.match(source, /"X-CSRF-Token": creatorSession\.csrfToken/);
  assert.match(source, /fetch\("\/api\/v2\/auth\/logout"/);
  assert.match(source, /private drafts, remembers which scrolls are yours/);
  assert.match(source, /keyInput\.value = ""/);
  assert.match(source, /autoComplete="off"/);
  assert.match(source, /data-1p-ignore/);
  assert.doesNotMatch(source, /localStorage.*apiKey|sessionStorage.*apiKey/i);
  assert.match(source, /Authorization: `Bearer \$\{apiKey\}`/);
  assert.match(source, /requestHeaders\["Idempotency-Key"\] = idempotencyKey/);
  assert.match(source, /PENDING_CREATION_STORAGE_KEY/);
  assert.match(source, /fetch\(`\/api\/v1\/jobs\/\$\{encodeURIComponent\(jobId\)\}`/);
  assert.match(source, /payload\.job\.status === "completed"/);
  assert.match(source, /retryRequired/);
  assert.ok(
    source.indexOf('keyInput.value = ""') < source.indexOf('fetch("/api/v1/stories"'),
    "the key is cleared from the form before generation begins",
  );
});

test("creator studio supports owned files, public-domain catalog books, and original-story teaching", async () => {
  const source = await readFile(studioUrl, "utf8");

  assert.match(source, /type SourceLane = "upload" \| "gutenberg" \| "ai_original"/);
  assert.match(source, /Upload \.txt or \.md/);
  assert.match(source, /multipart\.append\("manuscript", manuscriptFile/);
  assert.match(source, /I confirm that I have the right to submit, transform, illustrate, store, and share/);
  assert.match(source, /\/api\/v1\/gutenberg\/search\?q=/);
  assert.match(source, /Search the public-domain catalog/);
  assert.match(source, /chooseGutenbergBook/);
  assert.match(source, /canonical source-edition link is recorded automatically/);
  assert.match(source, /\/api\/v1\/gutenberg\/books\/\$\{ebookId\}/);
  assert.match(source, /setSourceEdition\("Public-domain UTF-8 source edition"\)/);
  assert.match(source, /setOriginalLanguage\(book\.languages\.map\(languageLabel\)/);
  assert.match(source, /You do not need to write a legal explanation for work you own/);
  for (const fieldName of [
    "premise",
    "protagonist",
    "characterDesire",
    "characterNeed",
    "centralConflict",
    "stakes",
    "incitingTurn",
    "midpointTurn",
    "climaxChoice",
    "characterArc",
    "themeLesson",
    "plannedEnding",
  ]) {
    assert.match(source, new RegExp(`name="${fieldName}"`));
  }
  assert.match(source, /Build a causal chapter arc before drafting/);
  assert.match(source, /earn the ending rather than announcing the lesson/);
});

test("verified public-domain catalog books bypass the manual rights-confirmation step", async () => {
  const source = await readFile(studioUrl, "utf8");
  assert.match(source, /sourceLane === "gutenberg"\s*\? \(\[1, 3, 4, 5, 6\] as const\)/);
  assert.match(source, /confirmed: sourceLane === "gutenberg" \|\| data\.get\("rightsConfirmed"\) === "on"/);
  assert.match(source, /sourceLane === "gutenberg" \? "Shape the story" : "Confirm permission"/);
  assert.match(source, /moveToStep\(sourceLane === "gutenberg" \? 1 : 2\)/);
  assert.match(source, /const displayedSectionNumber = \(sectionStep: number\)/);
  assert.match(source, /visibleIndex >= 0 \? visibleIndex \+ 1 : sectionStep/);
  for (const step of [1, 2, 3, 4, 5, 6]) {
    assert.match(source, new RegExp(`number=\\{displayedSectionNumber\\(${step}\\)\\}`));
  }
  assert.doesNotMatch(source, /<StudioHeading[^>]*number="0[1-6]"/);
});

test("creator studio exposes bounded rewriting, summaries, age adaptation, and image-led books", async () => {
  const source = await readFile(studioUrl, "utf8");

  for (const choice of ["faithful", "summary", "translate", "modernize", "reimagine", "alternate_ending"]) {
    assert.match(source, new RegExp(`\\| "${choice}"|\\["${choice}"`));
  }
  assert.match(source, /Story digest/);
  assert.match(source, /Every level keeps the central arc, motivations, turning points, consequences, and ending/);
  assert.match(source, /Target language/);
  assert.match(source, /Modernization depth/);
  assert.match(source, /Reimagining boundaries/);
  assert.match(source, /Alternate ending/);
  assert.match(source, /Adapt for an age/);
  assert.match(source, /Picture-book mode/);
  assert.match(source, /Story prose becomes a private storyboard/);
  assert.match(source, /concise accessible alt text/);
  assert.match(source, /min=\{2\} max=\{120\}/);
  assert.match(source, /Age-aware recommendation/);
  assert.match(source, /additional scenes go to visually busy chapters/);
  assert.match(source, /type ScopeMode = "automatic" \| "custom"/);
  assert.match(source, /Automatic · recommended/);
  assert.match(source, /source size, treatment, summary depth, format, and intended reader/);
  assert.match(source, /Exact override/);
});

test("every creation has a cost-approved, coherent visual plan and transparent title-page provenance", async () => {
  const source = await readFile(studioUrl, "utf8");

  assert.match(source, /requiredAssets: \{[\s\S]*cover: 1,[\s\S]*chapterHeroesPerChapter: 1,[\s\S]*inlinePerChapter: 1/);
  assert.match(source, /a cover, a wide chapter opener, and at least one inline scene per chapter/);
  assert.match(source, /Prompts require each named character to appear no more than once in a scene/);
  assert.match(source, /name="continuityCharacters"/);
  assert.match(source, /One exact character name per line, up to 8/);
  assert.match(source, /continuityCharacters: continuityCharacters\.length \? continuityCharacters : undefined/);
  assert.match(source, /continuityCharacters: payload\.generation\.continuityCharacters/);
  assert.match(source, /\/api\/v1\/character-bibles/);
  assert.match(source, /Approve the visual reference before production/);
  assert.match(source, /That exact approved sheet—not an unseen replacement/);
  assert.match(source, /Approve this exact visual reference/);
  assert.match(source, /source: payload\.source/);
  assert.match(source, /fetch\("\/api\/v1\/estimates"/);
  assert.match(source, /estimateApproval/);
  assert.match(source, /project budgets are soft alert thresholds/);
  assert.match(source, /fetch\("\/api\/v2\/illuminated-sets"/);
  assert.match(source, /illuminatedSetId: selectedIlluminatedId/);
  assert.match(source, /Homemade Apple/);
  assert.match(source, /Caveat Brush/);
  assert.match(source, /Literata/);
  assert.match(source, /Atkinson Hyperlegible/);
  assert.match(source, /Nunito/);
  assert.match(source, /Classic book serif/);
  assert.match(source, /creatorName/);
  assert.match(source, /originalAuthor/);
  assert.match(source, /sourceMetadata/);
  assert.match(source, /changeDescription/);
  assert.match(source, /GPT-5\.6 Sol/);
  assert.match(source, /Free creators may request one public-library review in a rolling seven-day window/);
  assert.match(source, /Private and unlisted scrolls remain unlimited/);
});

test("the Review step offers a transient best-effort spend cap without pretending to meter provider billing", async () => {
  const source = await readFile(studioUrl, "utf8");
  const styles = await readFile(new URL("../app/platform.css", import.meta.url), "utf8");

  assert.match(source, /const \[spendCapEnabled, setSpendCapEnabled\] = useState\(true\)/);
  assert.match(source, /function recommendedSpendCap\(estimatedMaxUsd: number\)/);
  assert.match(source, /Math\.max\(0\.25, estimate \* 0\.15\)/);
  assert.match(source, /name="spendCapEnabled"/);
  assert.match(source, /name="spendCapUsd" type="number"/);
  assert.match(source, /spendCapUsd: spendCapEnabled \? parseSpendCap\(spendCapUsd\) \?\? undefined : undefined/);
  assert.match(source, /spendCapUsd: payload\.generation\.spendCapUsd/);
  assert.match(source, /best-effort preflight guardrail, not live billing metering/);
  assert.match(source, /Keep hard project or organization spend controls enabled in your OpenAI account/);
  assert.match(source, /actual provider charges and pricing may differ/);
  assert.match(source, /only provider account spend controls can enforce a hard billing limit/);
  assert.match(source, /error\?\.code !== "SPEND_CAP_EXCEEDED"/);
  assert.match(source, /actions\.includes\("increase_cap"\)/);
  assert.match(source, /actions\.includes\("reduce_quality_or_art"\)/);
  assert.match(source, /actions\.includes\("finish_as_is"\)/);
  assert.match(source, /No generation work started/);
  assert.match(styles, /\.ss-spend-cap\s*\{/);
  assert.match(styles, /\.ss-spend-cap-alert\s*\{/);
  assert.doesNotMatch(source, /localStorage.*spendCap|sessionStorage.*spendCap/i);
});

test("craft investment, adaptive art direction, and existing-version discovery stay explainable", async () => {
  const source = await readFile(studioUrl, "utf8");

  for (const stop of ["Sketch", "Storybook", "Crafted", "Heirloom", "Masterwork"]) {
    assert.match(source, new RegExp(`name: "${stop}"`));
  }
  assert.match(source, /aria-label="Investment in craft"/);
  assert.match(source, /Fine-tune this scroll/);
  assert.match(source, /aria-label="Writing craft"/);
  assert.match(source, /aria-label="Editorial refinement passes"/);
  assert.match(source, /aria-label="Illustrations per chapter"/);
  assert.match(source, /aria-label="Art fidelity"/);
  assert.match(source, /aria-label="Illustration delivery quality"/);
  assert.match(source, /customQuality: customQuality/);
  assert.match(source, /Controls local WebP encoding/);
  assert.match(source, /does not buy more model detail or increase the OpenAI estimate/);
  assert.match(source, /gentle non-frightening palette/);
  assert.match(source, /no imitation of any living artist/);
  assert.match(source, /Gentle-reader promise/);
  assert.match(source, /\/api\/v2\/source-versions\?/);
  assert.match(source, /Already on the shelf/);
  assert.match(source, /Create another interpretation anyway/);
  assert.match(source, /Only approved, publicly listed scrolls appear here/);
});

test("the Story Studio offers persistent quick help and keyboard-accessible contextual tooltips", async () => {
  const source = await readFile(studioUrl, "utf8");
  const styles = await readFile(new URL("../app/platform.css", import.meta.url), "utf8");

  assert.match(source, /const STUDIO_STEP_GUIDES = \[/);
  assert.match(source, /<dialog[\s\S]*className="ss-studio-guide"/);
  assert.match(source, /showModal\(\)/);
  assert.match(source, /Studio guide/);
  assert.match(source, /function studioGuideForStep/);
  assert.match(source, /The \{stepIds\.length === 5 \? "five" : "six"\} screens/);
  assert.match(source, /verified catalog rights screen skipped/);
  assert.match(source, /A clear checklist for right now/);
  assert.match(source, /The final screen has deliberate pauses/);
  assert.match(source, /Choose Prepare character guide/);
  assert.match(source, /After approval, re-enter your API key/);
  assert.match(source, /proceeds without a generated visual-guide pause/);
  assert.match(source, /New to OpenAI API keys\?/);
  assert.match(source, /role="tooltip"/);
  assert.match(source, /aria-describedby=\{tooltipId\}/);
  assert.match(source, /HelpTip label="Investment in craft"/);
  assert.match(source, /HelpTip label="Visibility"/);
  assert.match(source, /function ApiKeyGuide/);
  assert.match(source, /ChatGPT subscription/);
  assert.match(source, /settings\/organization\/api-keys/);
  assert.match(source, /settings\/organization\/billing\/overview/);
  assert.match(source, /small prepaid balance/);
  assert.match(source, /Auto recharge/);
  assert.match(source, /requests continue after/);
  assert.match(source, /settings\/organization\/limits/);
  assert.match(source, /platform\.openai\.com\/usage/);
  assert.match(source, /“Incorrect API key”/);
  assert.match(source, /“Insufficient quota” or billing error/);
  assert.match(source, /Never paste an API key into an email/);
  assert.match(source, /OpenAI’s official API quickstart/);
  assert.match(styles, /\.ss-studio-guide::backdrop/);
  assert.match(styles, /\.ss-studio-guide__screen/);
  assert.match(styles, /\.ss-studio-guide__route/);
  assert.match(styles, /\.ss-studio-guide__api-help/);
  assert.match(styles, /\.ss-help-tip:focus-within \.ss-help-tip__bubble/);
  assert.match(styles, /\.ss-api-key-guide__steps/);
  assert.match(styles, /\.ss-api-key-guide__guardrail/);
});

test("community catalog delegates debounced, paginated, combinable filters to the approved-public API", async () => {
  const source = await readFile(new URL("../app/platform/community-library.tsx", import.meta.url), "utf8");

  assert.match(source, /\/api\/v2\/community\?\$\{parameters\.toString\(\)\}/);
  assert.doesNotMatch(
    source,
    /setDebouncedQuery\(query\.trim\(\)\);\s*setPage\(1\);\s*setStatus\("loading"\);/,
    "the initial empty-query debounce must not put an already-loaded shelf back into loading",
  );
  assert.match(
    source,
    /const nextQuery = query\.trim\(\);\s*if \(nextQuery === debouncedQuery\) return;\s*setStatus\("loading"\);\s*setDebouncedQuery\(nextQuery\);/,
    "the query debounce enters loading only when the normalized query actually changes",
  );
  assert.match(source, /const requestId = \+\+requestSequence\.current;/);
  assert.equal(
    source.match(/controller\.signal\.aborted \|\| requestId !== requestSequence\.current/g)?.length,
    2,
    "both successful and failed stale responses must be ignored",
  );
  assert.match(source, /activeRequest\.current\?\.abort\(\)/);
  assert.match(
    source,
    /returningToCommittedQuery[\s\S]{0,320}setReloadTick/,
    "clearing a not-yet-debounced query must restart the committed request instead of leaving a loading shell",
  );
  for (const parameter of ["query", "ageBand", "language", "readingDepth", "format", "illustrationRichness", "transformation", "quality", "page", "limit"]) {
    assert.match(source, new RegExp(`parameters\\.set\\("${parameter}"|${parameter}:`));
  }
  assert.match(source, /Public and reviewed/);
  assert.match(source, /Filter approved public scrolls/);
  assert.match(source, /Quick digest/);
  assert.match(source, /Picture book/);
  assert.match(source, /Lavish art/);
  assert.match(source, /Reimagined or new ending/);
  assert.match(source, /Page \{page\} of \{pageCount\}/);
  assert.match(source, /No approved scroll matches every choice yet/);
});
