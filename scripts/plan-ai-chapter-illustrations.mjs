import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), "..");
const catalogPath = path.join(projectRoot, "config", "ai-illustrations.json");
const planRoot = path.join(
  projectRoot,
  "art-direction",
  "ai-illustrations",
  "chapter-plans",
);
const promptRoot = path.join(
  projectRoot,
  "output",
  "imagegen",
  "chapter-prompts",
);
const jobPath = path.join(
  projectRoot,
  "output",
  "imagegen",
  "chapter-illustration-jobs.tsv",
);

const NARRATIVE_BLOCK_TYPES = new Set(["paragraph", "verse"]);
const INLINE_WIDTH = 1024;
const INLINE_HEIGHT = 640;
const HERO_WIDTH = 1344;
const HERO_HEIGHT = 576;
const REFERENCE_SIZE = 816;
const MAX_EXCERPT_CHARACTERS = 1_400;
const HERO_OVERRIDES = new Map([
  [
    "winnie-the-pooh:chapter-005",
    {
      sourceBlockIndex: 6,
      passageExcerpt:
        "A quiet thistly corner of an English wood in fine spring morning light. In the foreground, a detached grey cloth tail with a plain brass drawing pin rests among moss and thistles, turning the landscape into a gentle woodland mystery. A winding path leads through new beech leaves toward the deeper forest; keep any distant toy figures tiny, indistinct, and without recognizable character traits. Emphasize the handmade object, spacious forest atmosphere, and the question of where the lost tail belongs. Show no branded or adaptation-specific character design.",
    },
  ],
  [
    "the-count-of-monte-cristo:chapter-020",
    {
      sourceBlockIndex: 23,
      passageExcerpt:
        "By torchlight, two prison bearers carry a heavy canvas bundle up the winding stone stairs of the Château d’If into the cold night. Edmond Dantès lies concealed inside, rigid and silent, sensing the fresh sea wind and waiting for his chance to escape. Emphasize suspense, the fortress passage, the torchbearer, and the mistral; show no injury or graphic content.",
    },
  ],
]);
const INLINE_PASSAGE_OVERRIDES = new Map([
  [
    "treasure-island:chapter-028:chapter-028-inline-01",
    "Inside the stockade by lantern light, Jim Hawkins stands boldly before Long John Silver and the seated pirates, having just revealed that he outwitted them and moved the schooner beyond their reach. The pirates stare at him in stunned silence while Silver studies him with ambiguous respect. Emphasize the tense verbal standoff and Jim’s courage; show no raised weapons, injury, or graphic content.",
  ],
]);
const PUBLIC_DOMAIN_TOY_ALIAS_JOBS = new Set([
  "winnie-the-pooh:chapter-004-inline-01",
  "winnie-the-pooh:chapter-005-hero",
  "winnie-the-pooh:chapter-006-hero",
  "winnie-the-pooh:chapter-006-inline-01",
  "winnie-the-pooh:chapter-007-hero",
  "winnie-the-pooh:chapter-007-inline-01",
  "winnie-the-pooh:chapter-008-hero",
  "winnie-the-pooh:chapter-008-inline-01",
  "winnie-the-pooh:chapter-009-inline-02",
  "winnie-the-pooh:chapter-011-hero",
]);

const normalizeSpace = (value) => value.replace(/\s+/gu, " ").trim();
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const relativePath = (value) =>
  path.relative(projectRoot, value).split(path.sep).join("/");

export function visibleBlockText(block) {
  if (!block || !NARRATIVE_BLOCK_TYPES.has(block.type)) return "";
  if (typeof block.text === "string") return normalizeSpace(block.text);
  if (Array.isArray(block.lines)) {
    return normalizeSpace(
      block.lines.filter((line) => typeof line === "string").join(" "),
    );
  }
  if (Array.isArray(block.runs)) {
    return normalizeSpace(
      block.runs
        .map((run) => run && typeof run.text === "string" ? run.text : "")
        .join(" "),
    );
  }
  return "";
}

export function countWords(value) {
  return value.match(/[\p{L}\p{N}]+(?:[\u2019'-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

export function chapterMetrics(chapter) {
  const narrativeBlocks = [];
  let narrativeWords = 0;

  for (const [blockIndex, block] of (chapter.blocks ?? []).entries()) {
    if (!NARRATIVE_BLOCK_TYPES.has(block?.type)) continue;
    const text = visibleBlockText(block);
    const wordCount = countWords(text);
    if (!text || wordCount === 0) continue;
    const wordStart = narrativeWords;
    narrativeWords += wordCount;
    narrativeBlocks.push({
      blockIndex,
      text,
      wordCount,
      wordStart,
      wordEnd: narrativeWords,
    });
  }

  const textBlocks = narrativeBlocks.length;
  const inlineQuota = Math.min(
    4,
    Math.max(
      1,
      Math.ceil(narrativeWords / 3_000),
      Math.ceil(textBlocks / 100),
    ),
  );

  return { narrativeBlocks, narrativeWords, textBlocks, inlineQuota };
}

function positionForRecord(record, totalWords) {
  if (!record || totalWords === 0) return 0.5;
  return (record.wordStart + record.wordCount / 2) / totalWords;
}

function positionForBlockIndex(records, blockIndex, totalWords) {
  if (totalWords === 0) return 0.5;
  const exact = records.find((record) => record.blockIndex === blockIndex);
  if (exact) return positionForRecord(exact, totalWords);
  const previous = records.filter((record) => record.blockIndex < blockIndex).at(-1);
  if (previous) return previous.wordEnd / totalWords;
  return 0;
}

function closestUnusedSlot(slots, position, claimedSlots) {
  return slots
    .filter((slot) => !claimedSlots.has(slot.number))
    .sort(
      (left, right) =>
        Math.abs(left.fraction - position) - Math.abs(right.fraction - position) ||
        left.number - right.number,
    )[0];
}

function chooseRecord(records, totalWords, fraction, usedBlockIndexes) {
  return records
    .filter((record) => !usedBlockIndexes.has(record.blockIndex))
    .sort(
      (left, right) =>
        Math.abs(positionForRecord(left, totalWords) - fraction) -
          Math.abs(positionForRecord(right, totalWords) - fraction) ||
        left.blockIndex - right.blockIndex,
    )[0];
}

function minimumSpacingFromInline(record, records, totalWords, inlineBlockIndexes) {
  const position = positionForRecord(record, totalWords);
  return Math.min(
    ...[...inlineBlockIndexes].map((blockIndex) =>
      Math.abs(
        position - positionForBlockIndex(records, blockIndex, totalWords),
      ),
    ),
  );
}

function chooseHeroRecord(records, totalWords, inlineBlockIndexes) {
  const distinctCandidates = records.filter(
    (record) => !inlineBlockIndexes.has(record.blockIndex),
  );
  const candidates = distinctCandidates.length ? distinctCandidates : records;
  const annotate = (record) => ({
    record,
    fraction: positionForRecord(record, totalWords),
    minimumInlineSeparation: minimumSpacingFromInline(
      record,
      records,
      totalWords,
      inlineBlockIndexes,
    ),
  });
  const annotated = candidates.map(annotate);
  const nearest = (fraction) =>
    [...annotated].sort(
      (left, right) =>
        Math.abs(left.fraction - fraction) -
          Math.abs(right.fraction - fraction) ||
        left.record.blockIndex - right.record.blockIndex,
    )[0];
  const early = nearest(0.1);
  if (early.minimumInlineSeparation >= 0.15) {
    return { ...early, selection: "establishing-10-percent" };
  }

  const closing = nearest(0.9);
  if (closing.minimumInlineSeparation >= 0.15) {
    return { ...closing, selection: "closing-90-percent" };
  }

  // Coarse paragraph boundaries can put the nearest 10% and 90% records just
  // inside the spacing threshold. If another record can honor the 15-point
  // semantic proxy, take the best-separated endpoint-like candidate instead.
  const ranked = [...annotated].sort(
    (left, right) =>
      right.minimumInlineSeparation - left.minimumInlineSeparation ||
      Math.min(
        Math.abs(left.fraction - 0.1),
        Math.abs(left.fraction - 0.9),
      ) -
        Math.min(
          Math.abs(right.fraction - 0.1),
          Math.abs(right.fraction - 0.9),
        ) ||
      Math.abs(left.fraction - 0.1) - Math.abs(right.fraction - 0.1) ||
      left.record.blockIndex - right.record.blockIndex,
  );
  const best = ranked[0];
  return {
    ...best,
    selection:
      distinctCandidates.length === 0
        ? "unavoidable-anchor-reuse"
        : best.minimumInlineSeparation >= 0.15
          ? "maximum-separation-threshold"
          : "maximum-available-separation",
  };
}

export function planChapterAnchors(chapter, existingScenes = []) {
  const metrics = chapterMetrics(chapter);
  const { narrativeBlocks, narrativeWords, inlineQuota } = metrics;
  if (!narrativeBlocks.length) {
    throw new Error(`Chapter ${chapter.id} has no visible narrative blocks.`);
  }

  const targetSlots = Array.from({ length: inlineQuota }, (_, index) => ({
    number: index + 1,
    fraction: (index + 1) / (inlineQuota + 1),
  }));
  const claimedSlots = new Set();
  const usedBlockIndexes = new Set(
    existingScenes.map((scene) => scene.afterBlockIndex),
  );

  for (const scene of [...existingScenes].sort(
    (left, right) => left.afterBlockIndex - right.afterBlockIndex,
  )) {
    const slot = closestUnusedSlot(
      targetSlots,
      positionForBlockIndex(
        narrativeBlocks,
        scene.afterBlockIndex,
        narrativeWords,
      ),
      claimedSlots,
    );
    if (slot) claimedSlots.add(slot.number);
  }

  const planned = [];
  for (const slot of targetSlots.filter((item) => !claimedSlots.has(item.number))) {
    const record = chooseRecord(
      narrativeBlocks,
      narrativeWords,
      slot.fraction,
      usedBlockIndexes,
    );
    if (!record) {
      throw new Error(
        `Chapter ${chapter.id} does not have enough unique narrative anchors for its quota.`,
      );
    }
    usedBlockIndexes.add(record.blockIndex);
    planned.push({
      targetSlot: slot.number,
      targetFraction: slot.fraction,
      record,
    });
  }

  // A hero should establish the chapter early without simply widening one of its
  // inline moments. Prefer ~10%, fall back to ~90%, and keep at least 15% of the
  // chapter's cumulative words between roles whenever paragraph structure allows.
  const hero = chooseHeroRecord(
    narrativeBlocks,
    narrativeWords,
    usedBlockIndexes,
  );
  return {
    ...metrics,
    heroRecord: hero.record,
    heroFraction: hero.fraction,
    heroMinimumInlineSeparation: hero.minimumInlineSeparation,
    heroSelection: hero.selection,
    planned,
  };
}

function excerptForRecord(records, record) {
  const recordIndex = records.indexOf(record);
  const passage = normalizeSpace(
    records
      .slice(Math.max(0, recordIndex - 1), recordIndex + 2)
      .map((item) => item.text)
      .join(" "),
  );
  if (passage.length <= MAX_EXCERPT_CHARACTERS) return passage;

  const targetText = record.text;
  const targetOffset = Math.max(0, passage.indexOf(targetText));
  const center = targetOffset + Math.min(targetText.length, MAX_EXCERPT_CHARACTERS) / 2;
  const start = Math.max(
    0,
    Math.min(passage.length - MAX_EXCERPT_CHARACTERS, center - MAX_EXCERPT_CHARACTERS / 2),
  );
  const clipped = passage.slice(start, start + MAX_EXCERPT_CHARACTERS).trim();
  return `${start > 0 ? "\u2026" : ""}${clipped}${
    start + MAX_EXCERPT_CHARACTERS < passage.length ? "\u2026" : ""
  }`;
}

function publicDomainToyAlias(value) {
  return value
    .replace(/Christopher Robin/giu, "the young boy")
    .replace(/Winnie-the-Pooh|Winnie the Pooh|Pooh/giu, "the small shaggy honey-brown teddy bear")
    .replace(/Piglet/giu, "the tiny pale-pink stuffed pig")
    .replace(/Eeyore/giu, "the melancholy grey stuffed donkey")
    .replace(/Rabbit/giu, "the woodland rabbit")
    .replace(/Owl/giu, "the owl")
    .replace(/Kanga/giu, "the mother kangaroo toy")
    .replace(/\bRoo\b/giu, "the little kangaroo toy")
    .replace(/Heffalump/giu, "an imagined elephant-like creature")
    .replace(/Woozle/giu, "an imagined woodland creature");
}

function sharedPrompt({
  story,
  chapter,
  style,
  referenceImage,
  passageExcerpt,
  publicDomainToyAlias: usePublicDomainToyAlias = false,
}) {
  if (usePublicDomainToyAlias) {
    return [
      `BOOK: An original illustrated interpretation of a 1926 public-domain English woodland toy story by ${story.author}.`,
      "CHAPTER: A woodland toy-story chapter.",
      `BOOK-SPECIFIC VISUAL STYLE: ${style}`,
      "CONTINUITY REFERENCE: Use the supplied private cast-and-style atlas as the binding reference for recurring faces, ages, body proportions, clothing, props, palette, mark-making, and period detail. Do not copy its composition.",
      "The characters must remain original generic handcrafted toys. Do not imitate Disney, film, television, merchandise, branded, red-shirt, or any later adaptation design.",
      "LOCAL SOURCE MOMENT (depict this moment faithfully; do not add later-story events):",
      passageExcerpt,
    ].join("\n\n");
  }
  return [
    `BOOK: ${story.title} by ${story.author}.`,
    `CHAPTER: ${chapter.title || chapter.label || chapter.id}.`,
    `BOOK-SPECIFIC VISUAL STYLE: ${style}`,
    `CONTINUITY REFERENCE IMAGE: ${referenceImage}`,
    "Treat that image as the binding reference for recurring faces, ages, body proportions, clothing, props, palette, mark-making, and period detail. Do not copy its composition.",
    "LOCAL SOURCE PASSAGE (depict this moment faithfully; do not add later-story events):",
    passageExcerpt,
  ].join("\n\n");
}

function heroPrompt(context) {
  return `${sharedPrompt(context)}\n\nROLE AND COMPOSITION: Chapter hero illustration. Create a cinematic 21:9 panoramic chapter opener at exactly ${HERO_WIDTH}x${HERO_HEIGHT}. Establish the chapter's place, atmosphere, principal action, and emotional temperature in a wide environmental composition. Keep essential faces and action in the central safe area so responsive cropping remains graceful. Use foreground, middle distance, and background to give the panorama depth; avoid a poster, montage, collage, border, title card, or decorative frame.\n\nNo written words, letters, numbers, captions, logos, signatures, UI, or watermarks anywhere in the image.`;
}

function inlinePrompt(context, align) {
  return `${sharedPrompt(context)}\n\nROLE AND COMPOSITION: Interior inline narrative illustration at exactly ${INLINE_WIDTH}x${INLINE_HEIGHT} (landscape 8:5). Capture the single concrete beat in the local passage with clear character acting and a readable focal point. Compose for an ${align}-aligned placement beside book text: keep the subject away from the outer crop edge and preserve breathing room toward the text column. This is one continuous scene, not a montage, collage, poster, border, title card, or chapter hero.\n\nNo written words, letters, numbers, captions, logos, signatures, UI, or watermarks anywhere in the image.`;
}

function referencePrompt({ story, book, sourceImage, passageExcerpt, output }) {
  return [
    `BOOK: ${story.title} by ${story.author}.`,
    "ROLE: Private production continuity reference sheet; this is not a reader-facing illustration.",
    `EDIT INPUT: ${sourceImage}`,
    `OUTPUT: ${output} at exactly ${REFERENCE_SIZE}x${REFERENCE_SIZE}.`,
    `BOOK-SPECIFIC VISUAL STYLE: ${book.style}`,
    "Use the approved input scene as the binding source for its established design language. Expand it into a clean cast-and-style atlas for this single book: recurring principal characters shown consistently from useful angles, characteristic period clothing and props, a compact palette/material swatch area, and small environment motifs. Preserve the input's recognizable identities, proportions, medium, palette, and period authenticity. Keep the atlas visually useful as an image-generation reference, with separated studies and no reader-facing composition.",
    "PASSAGE ASSOCIATED WITH THE APPROVED SCENE:",
    passageExcerpt,
    "Do not include labels or any written words, letters, numbers, logos, signatures, UI, or watermarks.",
  ].join("\n\n");
}

async function writePrompt(promptPath, prompt) {
  const absolutePath = path.join(projectRoot, promptPath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${prompt.trim()}\n`);
}

function tsvCell(value) {
  return String(value ?? "").replace(/[\t\r\n]+/gu, " ");
}

export async function buildChapterIllustrationPlans() {
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const books = Object.entries(catalog.books ?? {});
  if (books.length !== 24 || books.some(([slug]) => slug.includes(["wandering", "inn"].join("-")))) {
    throw new Error("Planner requires exactly 24 approved catalog books and no removed legacy property.");
  }

  await mkdir(planRoot, { recursive: true });
  await rm(promptRoot, { recursive: true, force: true });
  await mkdir(promptRoot, { recursive: true });
  await mkdir(path.dirname(jobPath), { recursive: true });

  const allJobs = [];
  const totals = {
    books: books.length,
    chapters: 0,
    desiredInline: 0,
    retainedInline: 0,
    plannedInline: 0,
    plannedHeroes: 0,
    plannedReferences: 0,
  };

  for (const [slug, book] of books) {
    const storyPath = path.join(projectRoot, "public", "stories", slug, "story.json");
    const story = JSON.parse(await readFile(storyPath, "utf8"));
    if (story.slug !== slug || !Array.isArray(story.chapters)) {
      throw new Error(`Story source mismatch for ${slug}.`);
    }

    const chapterMap = new Map(story.chapters.map((chapter) => [chapter.id, chapter]));
    for (const scene of book.scenes ?? []) {
      if (!chapterMap.has(scene.chapterId)) {
        throw new Error(`Unknown existing scene chapter ${slug}/${scene.chapterId}.`);
      }
    }

    const referenceImage =
      book.referenceImage ?? `output/imagegen/references/${slug}.webp`;
    const bookJobs = [];
    let referenceJob = null;

    if (!book.referenceImage) {
      const sourceScene = book.scenes?.[0];
      if (!sourceScene) {
        throw new Error(`${slug} needs an approved scene to seed its reference atlas.`);
      }
      const sourceChapter = chapterMap.get(sourceScene.chapterId);
      const sourceMetrics = chapterMetrics(sourceChapter);
      const sourceRecord =
        sourceMetrics.narrativeBlocks.find(
          (record) => record.blockIndex === sourceScene.afterBlockIndex,
        ) ?? sourceMetrics.narrativeBlocks.at(-1);
      const jobId = `${slug}-reference-sheet`;
      const promptPath = `output/imagegen/chapter-prompts/${slug}/${jobId}.txt`;
      const prompt = referencePrompt({
        story,
        book,
        sourceImage: sourceScene.source,
        output: referenceImage,
        passageExcerpt: excerptForRecord(sourceMetrics.narrativeBlocks, sourceRecord),
      });
      await writePrompt(promptPath, prompt);
      referenceJob = {
        id: jobId,
        role: "reference-sheet",
        operation: "image-edit",
        width: REFERENCE_SIZE,
        height: REFERENCE_SIZE,
        sourceImage: sourceScene.source,
        output: referenceImage,
        prompt: promptPath,
        promptSha256: sha256(`${prompt.trim()}\n`),
      };
      bookJobs.push(referenceJob);
      totals.plannedReferences += 1;
    }

    const chapterPlans = [];
    for (const chapter of story.chapters) {
      const existingScenes = (book.scenes ?? []).filter(
        (scene) => scene.chapterId === chapter.id,
      );
      const metrics = planChapterAnchors(chapter, existingScenes);
      const heroOverride = HERO_OVERRIDES.get(`${slug}:${chapter.id}`);
      if (heroOverride) {
        const overrideRecord = metrics.narrativeBlocks.find(
          (record) => record.blockIndex === heroOverride.sourceBlockIndex,
        );
        if (!overrideRecord) {
          throw new Error(`Invalid curated hero override for ${slug}/${chapter.id}.`);
        }
        const inlineBlockIndexes = new Set([
          ...existingScenes.map((scene) => scene.afterBlockIndex),
          ...metrics.planned.map((scene) => scene.record.blockIndex),
        ]);
        if (inlineBlockIndexes.has(overrideRecord.blockIndex)) {
          throw new Error(`Curated hero override collides in ${slug}/${chapter.id}.`);
        }
        metrics.heroRecord = overrideRecord;
        metrics.heroFraction = positionForRecord(overrideRecord, metrics.narrativeWords);
        metrics.heroMinimumInlineSeparation = minimumSpacingFromInline(
          overrideRecord,
          metrics.narrativeBlocks,
          metrics.narrativeWords,
          inlineBlockIndexes,
        );
        metrics.heroSelection = "safety-compatible-curated-override";
      }
      const chapterLabel = chapter.title || chapter.label || chapter.id;
      const safeChapterId = chapter.id.replace(/[^a-zA-Z0-9-]+/gu, "-");

      const heroId = `${safeChapterId}-hero`;
      const heroJobKey = `${slug}:${heroId}`;
      const useHeroToyAlias = PUBLIC_DOMAIN_TOY_ALIAS_JOBS.has(heroJobKey);
      const heroPromptPath = `output/imagegen/chapter-prompts/${slug}/${heroId}.txt`;
      const heroOutput = `output/imagegen/chapter-scenes/${slug}/heroes/${heroId}.webp`;
      const rawHeroPassage = heroOverride?.passageExcerpt ?? excerptForRecord(
        metrics.narrativeBlocks,
        metrics.heroRecord,
      );
      const heroPassage = useHeroToyAlias
        ? publicDomainToyAlias(rawHeroPassage)
        : rawHeroPassage;
      const renderedHeroPrompt = heroPrompt({
        story,
        chapter,
        style: book.style,
        referenceImage,
        passageExcerpt: heroPassage,
        publicDomainToyAlias: useHeroToyAlias,
      });
      await writePrompt(heroPromptPath, renderedHeroPrompt);
      const hero = {
        id: heroId,
        role: "chapter-hero",
        status: "planned",
        operation: "image-edit",
        width: HERO_WIDTH,
        height: HERO_HEIGHT,
        aspectRatio: "21:9",
        sourceBlockIndex: metrics.heroRecord.blockIndex,
        sourceFraction: Number(metrics.heroFraction.toFixed(6)),
        minimumInlineSeparation: Number(
          metrics.heroMinimumInlineSeparation.toFixed(6),
        ),
        selection: metrics.heroSelection,
        sourceAnchorSha256: sha256(
          JSON.stringify(chapter.blocks[metrics.heroRecord.blockIndex]),
        ),
        passageExcerpt: heroPassage,
        referenceImage,
        output: heroOutput,
        prompt: heroPromptPath,
        promptSha256: sha256(`${renderedHeroPrompt.trim()}\n`),
      };
      bookJobs.push({
        ...hero,
        chapterId: chapter.id,
        dependsOn: referenceJob?.id ?? null,
      });

      const retained = [...existingScenes]
        .sort((left, right) => left.afterBlockIndex - right.afterBlockIndex)
        .map((scene) => ({
          id: scene.id,
          role: "inline",
          status: "approved-existing",
          afterBlockIndex: scene.afterBlockIndex,
          anchorSha256: sha256(
            JSON.stringify(chapter.blocks[scene.afterBlockIndex]),
          ),
          align: scene.align,
          source: scene.source,
          prompt: scene.prompt,
          caption: scene.caption,
        }));

      const plannedInline = [];
      for (const [plannedIndex, plannedAnchor] of metrics.planned.entries()) {
        const sequence = retained.length + plannedIndex + 1;
        const id = `${safeChapterId}-inline-${String(sequence).padStart(2, "0")}`;
        const inlineJobKey = `${slug}:${id}`;
        const useInlineToyAlias = PUBLIC_DOMAIN_TOY_ALIAS_JOBS.has(inlineJobKey);
        const align = sequence % 2 === 0 ? "left" : "right";
        const promptPath = `output/imagegen/chapter-prompts/${slug}/${id}.txt`;
        const output = `output/imagegen/chapter-scenes/${slug}/inline/${id}.webp`;
        const rawPassageExcerpt =
          INLINE_PASSAGE_OVERRIDES.get(`${slug}:${chapter.id}:${id}`) ??
          excerptForRecord(metrics.narrativeBlocks, plannedAnchor.record);
        const passageExcerpt = useInlineToyAlias
          ? publicDomainToyAlias(rawPassageExcerpt)
          : rawPassageExcerpt;
        const renderedPrompt = inlinePrompt(
          {
            story,
            chapter,
            style: book.style,
            referenceImage,
            passageExcerpt,
            publicDomainToyAlias: useInlineToyAlias,
          },
          align,
        );
        await writePrompt(promptPath, renderedPrompt);
        const plannedScene = {
          id,
          role: "inline",
          status: "planned",
          operation: "image-edit",
          width: INLINE_WIDTH,
          height: INLINE_HEIGHT,
          targetSlot: plannedAnchor.targetSlot,
          targetFraction: Number(plannedAnchor.targetFraction.toFixed(6)),
          afterBlockIndex: plannedAnchor.record.blockIndex,
          anchorSha256: sha256(
            JSON.stringify(chapter.blocks[plannedAnchor.record.blockIndex]),
          ),
          align,
          passageExcerpt,
          referenceImage,
          output,
          prompt: promptPath,
          promptSha256: sha256(`${renderedPrompt.trim()}\n`),
        };
        plannedInline.push(plannedScene);
        bookJobs.push({
          ...plannedScene,
          chapterId: chapter.id,
          dependsOn: referenceJob?.id ?? null,
        });
      }

      chapterPlans.push({
        id: chapter.id,
        number: chapter.number ?? null,
        title: chapterLabel,
        metrics: {
          narrativeWords: metrics.narrativeWords,
          textBlocks: metrics.textBlocks,
          inlineQuota: metrics.inlineQuota,
        },
        hero,
        inline: [...retained, ...plannedInline].sort(
          (left, right) => left.afterBlockIndex - right.afterBlockIndex,
        ),
      });

      totals.chapters += 1;
      totals.desiredInline += metrics.inlineQuota;
      totals.retainedInline += retained.length;
      totals.plannedInline += plannedInline.length;
      totals.plannedHeroes += 1;
    }

    const plan = {
      schemaVersion: 1,
      storySlug: slug,
      title: story.title,
      author: story.author,
      generation: {
        provider: catalog.generation.provider,
        model: catalog.generation.model,
        quality: catalog.generation.quality,
        format: catalog.generation.format,
      },
      artDirection: {
        style: book.style,
        referenceImage,
        referenceStatus: book.referenceImage ? "approved-existing" : "planned",
      },
      quota: {
        unit: "inline-illustrations-per-chapter",
        formula:
          "min(4, max(1, ceil(narrativeWords / 3000), ceil(textBlocks / 100)))",
        narrativeBlockTypes: ["paragraph", "verse"],
        heroesAreAdditionalToInlineQuota: true,
      },
      referenceJob,
      summary: {
        chapters: chapterPlans.length,
        desiredInline: chapterPlans.reduce(
          (sum, chapter) => sum + chapter.metrics.inlineQuota,
          0,
        ),
        retainedInline: chapterPlans.reduce(
          (sum, chapter) =>
            sum + chapter.inline.filter((scene) => scene.status === "approved-existing").length,
          0,
        ),
        plannedInline: chapterPlans.reduce(
          (sum, chapter) =>
            sum + chapter.inline.filter((scene) => scene.status === "planned").length,
          0,
        ),
        plannedHeroes: chapterPlans.length,
      },
      chapters: chapterPlans,
    };
    await writeFile(
      path.join(planRoot, `${slug}.json`),
      `${JSON.stringify(plan, null, 2)}\n`,
    );
    allJobs.push(...bookJobs.map((job) => ({ storySlug: slug, ...job })));
  }

  const tsvHeaders = [
    "story_slug",
    "job_id",
    "role",
    "operation",
    "chapter_id",
    "after_block_index",
    "width",
    "height",
    "reference_image",
    "source_image",
    "depends_on",
    "output",
    "prompt",
    "model",
    "quality",
  ];
  const tsvRows = allJobs.map((job) => [
    job.storySlug,
    job.id,
    job.role,
    job.operation,
    job.chapterId,
    job.afterBlockIndex,
    job.width,
    job.height,
    job.referenceImage,
    job.sourceImage,
    job.dependsOn,
    job.output,
    job.prompt,
    catalog.generation.model,
    catalog.generation.quality,
  ]);
  await writeFile(
    jobPath,
    `${[tsvHeaders, ...tsvRows]
      .map((row) => row.map(tsvCell).join("\t"))
      .join("\n")}\n`,
  );

  return {
    ...totals,
    totalJobs: allJobs.length,
    planDirectory: relativePath(planRoot),
    promptDirectory: relativePath(promptRoot),
    jobFile: relativePath(jobPath),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const totals = await buildChapterIllustrationPlans();
  console.log(
    `Planned ${totals.totalJobs} generation jobs for ${totals.chapters} chapters across ${totals.books} books: ${totals.plannedHeroes} heroes, ${totals.plannedInline} new inline scenes, ${totals.plannedReferences} reference sheets; ${totals.retainedInline} approved inline scenes retained toward ${totals.desiredInline} desired.`,
  );
  console.log(
    `Plans: ${totals.planDirectory}; prompts: ${totals.promptDirectory}; jobs: ${totals.jobFile}.`,
  );
}
