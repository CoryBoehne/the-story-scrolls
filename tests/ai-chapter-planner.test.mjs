import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  chapterMetrics,
  countWords,
  planChapterAnchors,
  visibleBlockText,
} from "../scripts/plan-ai-chapter-illustrations.mjs";

const projectRoot = process.cwd();
const readJson = async (...segments) =>
  JSON.parse(await readFile(path.join(projectRoot, ...segments), "utf8"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fractionForBlock = (metrics, blockIndex) => {
  const exact = metrics.narrativeBlocks.find(
    (record) => record.blockIndex === blockIndex,
  );
  if (exact) {
    return (exact.wordStart + exact.wordCount / 2) / metrics.narrativeWords;
  }
  const previous = metrics.narrativeBlocks
    .filter((record) => record.blockIndex < blockIndex)
    .at(-1);
  return previous ? previous.wordEnd / metrics.narrativeWords : 0;
};

test("planner counts visible narrative text once and caps the inline quota at four", () => {
  const duplicateRunBlock = {
    type: "paragraph",
    text: "Visible words appear once.",
    runs: [{ text: "Visible words appear once." }],
  };
  assert.equal(visibleBlockText(duplicateRunBlock), "Visible words appear once.");
  assert.equal(countWords(visibleBlockText(duplicateRunBlock)), 4);

  const chapter = {
    id: "long-chapter",
    blocks: Array.from({ length: 500 }, () => ({
      type: "paragraph",
      text: Array.from({ length: 30 }, () => "word").join(" "),
    })),
  };
  const metrics = chapterMetrics(chapter);
  assert.equal(metrics.narrativeWords, 15_000);
  assert.equal(metrics.textBlocks, 500);
  assert.equal(metrics.inlineQuota, 4);
});

test("anchor planning uses cumulative-word target slots without duplicate anchors", () => {
  const chapter = {
    id: "sample",
    blocks: Array.from({ length: 101 }, (_, index) => ({
      type: "paragraph",
      text: Array.from({ length: index === 50 ? 2_900 : 2 }, () => "word").join(" "),
    })),
  };
  const first = planChapterAnchors(chapter, [
    { chapterId: "sample", afterBlockIndex: 50 },
  ]);
  const second = planChapterAnchors(chapter, [
    { chapterId: "sample", afterBlockIndex: 50 },
  ]);

  assert.equal(first.inlineQuota, 2);
  assert.deepEqual(first.planned, second.planned);
  assert.equal(first.planned.length, 1);
  assert.notEqual(first.planned[0].record.blockIndex, 50);
  assert.ok([1 / 3, 2 / 3].includes(first.planned[0].targetFraction));
});

test("chapter plans cover every curated chapter with heroes and the canonical inline density", async () => {
  const catalog = await readJson("config", "ai-illustrations.json");
  const books = Object.entries(catalog.books);
  const totals = {
    chapters: 0,
    desiredInline: 0,
    retainedInline: 0,
    plannedInline: 0,
    heroes: 0,
    references: 0,
  };
  const spacingExceptions = [];

  assert.equal(books.length, 24);
  assert.equal(new Set(books.map(([slug]) => slug)).size, 24);

  for (const [slug, book] of books) {
    const [story, plan] = await Promise.all([
      readJson("public", "stories", slug, "story.json"),
      readJson(
        "art-direction",
        "ai-illustrations",
        "chapter-plans",
        `${slug}.json`,
      ),
    ]);
    assert.equal(plan.storySlug, slug);
    assert.equal(plan.artDirection.style, book.style);
    assert.equal(plan.chapters.length, story.chapters.length);
    assert.equal(plan.quota.heroesAreAdditionalToInlineQuota, true);

    if (book.referenceImage) {
      assert.equal(plan.artDirection.referenceImage, book.referenceImage);
      assert.equal(plan.referenceJob, null);
    } else {
      totals.references += 1;
      assert.equal(
        plan.artDirection.referenceImage,
        `output/imagegen/references/${slug}.webp`,
      );
      assert.equal(plan.referenceJob.role, "reference-sheet");
      assert.equal(plan.referenceJob.operation, "image-edit");
      assert.equal(plan.referenceJob.width, 816);
      assert.equal(plan.referenceJob.height, 816);
      assert.equal(plan.referenceJob.sourceImage, book.scenes[0].source);
    }

    const storyChapterMap = new Map(
      story.chapters.map((chapter) => [chapter.id, chapter]),
    );
    const existingSceneIds = new Set(book.scenes.map((scene) => scene.id));
    for (const chapterPlan of plan.chapters) {
      const chapter = storyChapterMap.get(chapterPlan.id);
      assert.ok(chapter, `${slug}/${chapterPlan.id} must exist`);
      const metrics = chapterMetrics(chapter);
      assert.deepEqual(chapterPlan.metrics, {
        narrativeWords: metrics.narrativeWords,
        textBlocks: metrics.textBlocks,
        inlineQuota: metrics.inlineQuota,
      });
      assert.equal(chapterPlan.inline.length, metrics.inlineQuota);
      assert.equal(chapterPlan.hero.role, "chapter-hero");
      assert.equal(chapterPlan.hero.width, 1344);
      assert.equal(chapterPlan.hero.height, 576);
      assert.equal(chapterPlan.hero.aspectRatio, "21:9");
      assert.equal(
        chapterPlan.hero.sourceAnchorSha256,
        sha256(JSON.stringify(chapter.blocks[chapterPlan.hero.sourceBlockIndex])),
      );

      const anchorIndexes = new Set();
      for (const illustration of chapterPlan.inline) {
        assert.equal(anchorIndexes.has(illustration.afterBlockIndex), false);
        anchorIndexes.add(illustration.afterBlockIndex);
        assert.equal(
          illustration.anchorSha256,
          sha256(JSON.stringify(chapter.blocks[illustration.afterBlockIndex])),
        );
        if (illustration.status === "approved-existing") {
          assert.equal(existingSceneIds.has(illustration.id), true);
          totals.retainedInline += 1;
        } else {
          assert.equal(illustration.status, "planned");
          assert.equal(illustration.role, "inline");
          assert.equal(illustration.width, 1024);
          assert.equal(illustration.height, 640);
          assert.equal(
            illustration.targetFraction,
            Number(
              (illustration.targetSlot / (metrics.inlineQuota + 1)).toFixed(6),
            ),
          );
          totals.plannedInline += 1;
        }
      }
      if (metrics.narrativeBlocks.length > 1) {
        assert.equal(
          anchorIndexes.has(chapterPlan.hero.sourceBlockIndex),
          false,
          `${slug}/${chapter.id} hero must not duplicate an inline anchor`,
        );
      }

      const inlineFractions = chapterPlan.inline.map((illustration) =>
        fractionForBlock(metrics, illustration.afterBlockIndex),
      );
      const heroFraction = fractionForBlock(
        metrics,
        chapterPlan.hero.sourceBlockIndex,
      );
      const minimumSpacing = Math.min(
        ...inlineFractions.map((fraction) => Math.abs(heroFraction - fraction)),
      );
      assert.equal(
        chapterPlan.hero.sourceFraction,
        Number(heroFraction.toFixed(6)),
      );
      assert.equal(
        chapterPlan.hero.minimumInlineSeparation,
        Number(minimumSpacing.toFixed(6)),
      );

      const eligibleHeroRecords = metrics.narrativeBlocks.filter(
        (record) => !anchorIndexes.has(record.blockIndex),
      );
      const maximumAvailableSpacing = eligibleHeroRecords.length
        ? Math.max(
            ...eligibleHeroRecords.map((record) =>
              Math.min(
                ...inlineFractions.map((fraction) =>
                  Math.abs(
                    fractionForBlock(metrics, record.blockIndex) - fraction,
                  ),
                ),
              ),
            ),
          )
        : 0;
      if (maximumAvailableSpacing >= 0.15) {
        assert.ok(
          minimumSpacing >= 0.15,
          `${slug}/${chapter.id} must use the available 15-point separation`,
        );
      } else {
        spacingExceptions.push({ slug, chapterId: chapter.id });
      }

      totals.chapters += 1;
      totals.desiredInline += metrics.inlineQuota;
      totals.heroes += 1;
    }
  }

  assert.deepEqual(totals, {
    chapters: 747,
    desiredInline: 1_089,
    retainedInline: 42,
    plannedInline: 1_047,
    heroes: 747,
    references: 18,
  });
  assert.deepEqual(spacingExceptions, []);
});

test("Alice chapter one falls back from the retained fall scene to a separated closing hero", async () => {
  const plan = await readJson(
    "art-direction",
    "ai-illustrations",
    "chapter-plans",
    "alice-in-wonderland.json",
  );
  const chapter = plan.chapters.find((item) => item.id === "chapter-01");
  assert.equal(chapter.inline[0].afterBlockIndex, 3);
  assert.equal(chapter.hero.selection, "closing-90-percent");
  assert.ok(chapter.hero.sourceFraction > 0.8);
  assert.ok(chapter.hero.minimumInlineSeparation >= 0.15);
});

test("curated safety override replaces the blocked Monte Cristo passage", async () => {
  const plan = await readJson(
    "art-direction",
    "ai-illustrations",
    "chapter-plans",
    "the-count-of-monte-cristo.json",
  );
  const chapter = plan.chapters.find((item) => item.id === "chapter-020");
  assert.equal(chapter.hero.sourceBlockIndex, 23);
  assert.equal(chapter.hero.selection, "safety-compatible-curated-override");
  assert.doesNotMatch(chapter.hero.passageExcerpt, /suicid|strangle|guillotine/iu);
  assert.match(chapter.hero.passageExcerpt, /torchlight/iu);
});

test("curated inline override replaces the blocked Treasure Island passage", async () => {
  const plan = await readJson(
    "art-direction",
    "ai-illustrations",
    "chapter-plans",
    "treasure-island.json",
  );
  const chapter = plan.chapters.find((item) => item.id === "chapter-028");
  const scene = chapter.inline.find((item) => item.id === "chapter-028-inline-01");
  assert.equal(scene.afterBlockIndex, 23);
  assert.doesNotMatch(scene.passageExcerpt, /kill me|gallows|killed the men/iu);
  assert.match(scene.passageExcerpt, /stunned silence/iu);
});

test("filtered woodland jobs use generic public-domain toy identities", async () => {
  const [hero, inline] = await Promise.all([
    readFile(
      path.join(
        projectRoot,
        "output/imagegen/chapter-prompts/winnie-the-pooh/chapter-005-hero.txt",
      ),
      "utf8",
    ),
    readFile(
      path.join(
        projectRoot,
        "output/imagegen/chapter-prompts/winnie-the-pooh/chapter-004-inline-01.txt",
      ),
      "utf8",
    ),
  ]);
  for (const prompt of [hero, inline]) {
    assert.match(prompt, /public-domain English woodland toy story/iu);
    assert.match(prompt, /original generic handcrafted toys/iu);
    assert.doesNotMatch(prompt, /Winnie|Pooh|Piglet|Eeyore|Christopher Robin/iu);
  }
});

test("generation queue contains only planned work and prompts bind style, passage, role, and reference", async () => {
  const queue = await readFile(
    path.join(
      projectRoot,
      "output",
      "imagegen",
      "chapter-illustration-jobs.tsv",
    ),
    "utf8",
  );
  const lines = queue.trimEnd().split("\n");
  assert.equal(lines.length, 1_813);
  assert.match(lines[0], /\tmodel\tquality$/);
  assert.equal(lines.slice(1).every((line) => line.endsWith("\tgpt-image-2\tlow")), true);
  assert.equal(lines.filter((line) => line.includes("\treference-sheet\t")).length, 18);
  assert.equal(lines.filter((line) => line.includes("\tchapter-hero\t")).length, 747);
  assert.equal(lines.filter((line) => line.includes("\tinline\t")).length, 1_047);
  assert.equal(new Set(lines.slice(1).map((line) => line.split("\t")[0])).size, 24);

  const [reference, hero, inline] = await Promise.all([
    readFile(
      path.join(
        projectRoot,
        "output/imagegen/chapter-prompts/alice-in-wonderland/alice-in-wonderland-reference-sheet.txt",
      ),
      "utf8",
    ),
    readFile(
      path.join(
        projectRoot,
        "output/imagegen/chapter-prompts/alice-in-wonderland/chapter-01-hero.txt",
      ),
      "utf8",
    ),
    readFile(
      path.join(
        projectRoot,
        "output/imagegen/chapter-prompts/alice-in-wonderland/chapter-02-inline-01.txt",
      ),
      "utf8",
    ),
  ]);
  assert.match(reference, /EDIT INPUT: output\/imagegen\/singles\/alice-in-wonderland\/scene\.webp/);
  assert.match(reference, /cast-and-style atlas/);
  assert.match(hero, /CONTINUITY REFERENCE IMAGE: output\/imagegen\/references\/alice-in-wonderland\.webp/);
  assert.match(hero, /LOCAL SOURCE PASSAGE/);
  assert.match(hero, /21:9 panoramic chapter opener at exactly 1344x576/);
  assert.match(inline, /landscape 8:5/);
  assert.match(inline, /exactly 1024x640/);
  for (const prompt of [reference, hero, inline]) {
    assert.match(prompt, /words/);
    assert.match(prompt, /logos/);
    assert.match(prompt, /signatures/);
    assert.match(prompt, /watermarks/);
  }
});
