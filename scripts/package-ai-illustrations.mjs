import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const projectRoot = process.cwd();
const configPath = path.join(projectRoot, "config", "ai-illustrations.json");
const planDirectory = path.join(
  projectRoot,
  "art-direction",
  "ai-illustrations",
  "chapter-plans",
);
const config = JSON.parse(await readFile(configPath, "utf8"));

if (config.schemaVersion !== 1 || config.generation?.model !== "gpt-image-2") {
  throw new Error("Unsupported AI illustration catalog.");
}
if (config.generation.quality !== "low") {
  throw new Error("Curated illustration generation must remain on low quality.");
}

const entries = Object.entries(config.books ?? {});
if (entries.length !== 24 || entries.some(([slug]) => slug.includes(["wandering", "inn"].join("-")))) {
  throw new Error("The public catalog must contain exactly 24 approved books and no removed legacy property.");
}

const hash = (value) => createHash("sha256").update(value).digest("hex");
const validAlignments = new Set(["left", "right", "plate"]);
const copyJobs = [];
const manifestJobs = [];
let assetCount = 0;
let heroCount = 0;
let inlineCount = 0;
let totalBytes = 0;

function resolveWithin(relativePath, allowedRoots, label) {
  if (typeof relativePath !== "string" || !relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`Invalid ${label} path.`);
  }
  const resolved = path.resolve(projectRoot, relativePath);
  const allowed = allowedRoots.some((root) => {
    const resolvedRoot = path.resolve(projectRoot, root);
    return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`);
  });
  if (!allowed) throw new Error(`${label} escapes its approved directory.`);
  return resolved;
}

function visibleBlockText(block) {
  if (!block || (block.type !== "paragraph" && block.type !== "verse")) return "";
  const text = typeof block.text === "string"
    ? block.text
    : Array.isArray(block.lines)
      ? block.lines.filter((line) => typeof line === "string").join(" ")
      : Array.isArray(block.runs)
        ? block.runs
            .map((run) => run && typeof run.text === "string" ? run.text : "")
            .join(" ")
        : "";
  return text.replace(/\s+/gu, " ").trim();
}

function countWords(value) {
  return value.match(/[\p{L}\p{N}]+(?:[\u2019'-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

function chapterMetrics(chapter) {
  const narrativeBlocks = (chapter.blocks ?? []).flatMap((block, blockIndex) => {
    const text = visibleBlockText(block);
    const wordCount = countWords(text);
    return text && wordCount ? [{ blockIndex, wordCount }] : [];
  });
  const narrativeWords = narrativeBlocks.reduce((sum, block) => sum + block.wordCount, 0);
  const textBlocks = narrativeBlocks.length;
  const inlineQuota = Math.min(
    4,
    Math.max(1, Math.ceil(narrativeWords / 3_000), Math.ceil(textBlocks / 100)),
  );
  return { narrativeBlocks, narrativeWords, textBlocks, inlineQuota };
}

for (const [slug, book] of entries) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug) || slug.includes(["wandering", "inn"].join("-"))) {
    throw new Error(`Invalid curated story slug ${slug}.`);
  }
  const storyPath = path.join(projectRoot, "public", "stories", slug, "story.json");
  const planPath = path.join(planDirectory, `${slug}.json`);
  const [story, plan] = await Promise.all([
    readFile(storyPath, "utf8").then(JSON.parse),
    readFile(planPath, "utf8").then(JSON.parse),
  ]);
  if (story.slug !== slug || !Array.isArray(story.chapters)) {
    throw new Error(`Story source mismatch for ${slug}.`);
  }
  if (
    plan.schemaVersion !== 1 ||
    plan.storySlug !== slug ||
    plan.generation?.model !== "gpt-image-2" ||
    plan.generation?.quality !== "low" ||
    plan.generation?.format !== config.generation.format ||
    !Array.isArray(plan.chapters) ||
    plan.chapters.length !== story.chapters.length
  ) {
    throw new Error(`Invalid chapter illustration plan for ${slug}.`);
  }
  if (!book.style || plan.artDirection?.style !== book.style) {
    throw new Error(`Missing or mismatched art direction for ${slug}.`);
  }

  const expectedReference = `output/imagegen/references/${slug}.webp`;
  if (plan.artDirection?.referenceImage !== expectedReference) {
    throw new Error(`Unexpected continuity-reference path for ${slug}.`);
  }
  const referencePath = resolveWithin(
    plan.artDirection.referenceImage,
    ["output/imagegen/references"],
    `${slug} continuity reference`,
  );
  const [referenceBuffer, referenceMetadata] = await Promise.all([
    readFile(referencePath),
    sharp(referencePath, { animated: false }).metadata(),
  ]);
  if (
    referenceMetadata.format !== "webp" ||
    !referenceMetadata.width ||
    !referenceMetadata.height ||
    (!book.referenceImage && referenceMetadata.width !== referenceMetadata.height) ||
    referenceMetadata.width % 16 !== 0 ||
    referenceMetadata.height % 16 !== 0 ||
    referenceMetadata.width * referenceMetadata.height < 655_360 ||
    referenceMetadata.width * referenceMetadata.height > 8_294_400 ||
    Math.max(referenceMetadata.width, referenceMetadata.height) > 3_840 ||
    Math.max(
      referenceMetadata.width / referenceMetadata.height,
      referenceMetadata.height / referenceMetadata.width,
    ) > 3 ||
    (referenceMetadata.pages && referenceMetadata.pages !== 1)
  ) {
    throw new Error(`Invalid private continuity reference for ${slug}.`);
  }
  const continuityReferenceSha256 = hash(referenceBuffer);

  const chapterMap = new Map(story.chapters.map((chapter) => [chapter.id, chapter]));
  const approvedSceneMap = new Map((book.scenes ?? []).map((scene) => [scene.id, scene]));
  if (
    chapterMap.size !== story.chapters.length ||
    approvedSceneMap.size !== (book.scenes ?? []).length ||
    approvedSceneMap.size === 0
  ) {
    throw new Error(`Duplicate or missing catalog records for ${slug}.`);
  }
  const retainedSceneIds = new Set();
  const assetIds = new Set();
  const heroChapters = new Set();
  const inlineChapters = new Set();
  const inlineOrdinalByChapter = new Map();
  const placements = [];
  const assets = [];
  const destinationDirectory = path.join(
    projectRoot,
    "public",
    "stories",
    slug,
    "ai-images",
  );

  for (const [chapterIndex, chapterPlan] of plan.chapters.entries()) {
    const chapter = chapterMap.get(chapterPlan.id);
    if (
      !chapter ||
      story.chapters[chapterIndex]?.id !== chapterPlan.id ||
      chapterPlan.number !== chapterIndex + 1 ||
      !chapterPlan.hero ||
      !Array.isArray(chapterPlan.inline)
    ) {
      throw new Error(`Incomplete chapter plan ${slug}/${chapterPlan.id}.`);
    }

    const metrics = chapterMetrics(chapter);
    if (
      chapterPlan.metrics?.narrativeWords !== metrics.narrativeWords ||
      chapterPlan.metrics?.textBlocks !== metrics.textBlocks ||
      chapterPlan.metrics?.inlineQuota !== metrics.inlineQuota ||
      chapterPlan.inline.length !== metrics.inlineQuota
    ) {
      throw new Error(`Incorrect illustration density for ${slug}/${chapter.id}.`);
    }

    const plannedItems = [chapterPlan.hero, ...chapterPlan.inline];
    const inlineAnchors = new Set(
      chapterPlan.inline.map((item) => item.afterBlockIndex),
    );
    if (
      metrics.narrativeBlocks.length > 1 &&
      inlineAnchors.has(chapterPlan.hero.sourceBlockIndex)
    ) {
      throw new Error(`Hero repeats an inline moment in ${slug}/${chapter.id}.`);
    }
    if (inlineAnchors.size !== chapterPlan.inline.length) {
      throw new Error(`Duplicate inline anchor in ${slug}/${chapter.id}.`);
    }
    const heroSourceBlock = chapter.blocks?.[chapterPlan.hero.sourceBlockIndex];
    if (
      chapterPlan.hero.status !== "planned" ||
      chapterPlan.hero.referenceImage !== expectedReference ||
      !heroSourceBlock ||
      !visibleBlockText(heroSourceBlock) ||
      chapterPlan.hero.sourceAnchorSha256 !== hash(JSON.stringify(heroSourceBlock))
    ) {
      throw new Error(`Invalid chapter-hero provenance for ${slug}/${chapter.id}.`);
    }

    for (const item of plannedItems) {
      const isHero = item.role === "chapter-hero";
      if (!isHero && item.role !== "inline") {
        throw new Error(`Invalid illustration role for ${slug}/${item.id}.`);
      }
      if (!/^[a-z0-9][a-z0-9-]*$/.test(item.id) || assetIds.has(item.id)) {
        throw new Error(`Invalid or duplicate asset id ${item.id} in ${slug}.`);
      }
      assetIds.add(item.id);

      if (item.status !== "planned" && item.status !== "approved-existing") {
        throw new Error(`Invalid asset status for ${slug}/${item.id}.`);
      }
      if (isHero && item.status !== "planned") {
        throw new Error(`Chapter hero ${slug}/${item.id} must be newly planned.`);
      }

      const isExisting = item.status === "approved-existing";
      const approvedScene = isExisting ? approvedSceneMap.get(item.id) : null;
      if (isExisting) {
        if (
          !approvedScene ||
          approvedScene.chapterId !== chapter.id ||
          approvedScene.afterBlockIndex !== item.afterBlockIndex ||
          approvedScene.align !== item.align ||
          approvedScene.caption !== item.caption ||
          approvedScene.source !== item.source ||
          approvedScene.prompt !== item.prompt ||
          retainedSceneIds.has(item.id)
        ) {
          throw new Error(`Unapproved retained scene ${slug}/${item.id}.`);
        }
        retainedSceneIds.add(item.id);
      } else if (item.referenceImage !== expectedReference) {
        throw new Error(`Planned asset ${slug}/${item.id} uses the wrong continuity reference.`);
      }

      const expectedOutput = isHero
        ? `output/imagegen/chapter-scenes/${slug}/heroes/${item.id}.webp`
        : `output/imagegen/chapter-scenes/${slug}/inline/${item.id}.webp`;
      const expectedPrompt = `output/imagegen/chapter-prompts/${slug}/${item.id}.txt`;
      if (!isExisting && (item.output !== expectedOutput || item.prompt !== expectedPrompt)) {
        throw new Error(`Unexpected generated-asset path for ${slug}/${item.id}.`);
      }

      const source = isExisting ? item.source : item.output;
      if (!source || !item.prompt) {
        throw new Error(`Missing source or prompt for ${slug}/${item.id}.`);
      }
      const sourcePath = resolveWithin(
        source,
        isExisting
          ? ["output/imagegen"]
          : [`output/imagegen/chapter-scenes/${slug}`],
        `${slug}/${item.id} source`,
      );
      const promptPath = resolveWithin(
        item.prompt,
        isExisting
          ? [`art-direction/ai-illustrations/scene-prompts/${slug}`]
          : [`output/imagegen/chapter-prompts/${slug}`],
        `${slug}/${item.id} prompt`,
      );
      const [sourceBuffer, prompt, sourceStats, metadata] = await Promise.all([
        readFile(sourcePath),
        readFile(promptPath, "utf8"),
        stat(sourcePath),
        sharp(sourcePath, { animated: false }).metadata(),
      ]);
      if (
        metadata.format !== "webp" ||
        !metadata.width ||
        !metadata.height ||
        (metadata.pages && metadata.pages !== 1)
      ) {
        throw new Error(`Asset ${slug}/${item.id} is not a single-frame WebP.`);
      }
      if (
        metadata.width % 16 !== 0 ||
        metadata.height % 16 !== 0 ||
        metadata.width * metadata.height < 655_360 ||
        metadata.width * metadata.height > 8_294_400 ||
        Math.max(metadata.width, metadata.height) > 3_840 ||
        Math.max(metadata.width / metadata.height, metadata.height / metadata.width) > 3
      ) {
        throw new Error(`Asset ${slug}/${item.id} is below the GPT Image 2 size floor.`);
      }
      if (isHero && (metadata.width !== 1344 || metadata.height !== 576)) {
        throw new Error(`Chapter hero ${slug}/${item.id} must be exactly 1344x576.`);
      }
      if (
        !isHero &&
        !isExisting &&
        (metadata.width !== 1024 || metadata.height !== 640)
      ) {
        throw new Error(`New inline asset ${slug}/${item.id} must be exactly 1024x640.`);
      }

      const sha256 = hash(sourceBuffer);
      const promptSha256 = hash(prompt);
      if (
        (!isExisting && !/^[a-f0-9]{64}$/.test(item.promptSha256 ?? "")) ||
        (item.promptSha256 && item.promptSha256 !== promptSha256)
      ) {
        throw new Error(`Prompt changed after planning for ${slug}/${item.id}.`);
      }
      const filename = `${item.id}-${sha256.slice(0, 12)}.webp`;
      const destinationPath = path.join(destinationDirectory, filename);
      copyJobs.push({ sourcePath, destinationPath });

      const assetId = `ai-${item.id}`;
      const chapterNumber = chapterPlan.number ?? story.chapters.indexOf(chapter) + 1;
      const inlineOrdinal = (inlineOrdinalByChapter.get(chapter.id) ?? 0) + 1;
      const caption = isHero
        ? `Chapter ${chapterNumber}: ${chapter.title}`
        : item.caption ?? `${chapter.title} — illustration ${inlineOrdinal}`;
      assets.push({
        id: assetId,
        type: "ai-illustration",
        path: `/stories/${slug}/ai-images/${filename}`,
        alt: isHero
          ? `AI chapter illustration for ${chapter.title} in ${story.title}.`
          : `AI illustration depicting a scene from ${chapter.title} in ${story.title}.`,
        caption,
        creator: "OpenAI GPT Image 2",
        mime: "image/webp",
        width: metadata.width,
        height: metadata.height,
        bytes: sourceStats.size,
        sha256,
        promptSha256,
      });

      if (isHero) {
        if (heroChapters.has(chapter.id)) {
          throw new Error(`Duplicate chapter hero for ${slug}/${chapter.id}.`);
        }
        heroChapters.add(chapter.id);
        placements.push({
          kind: "chapter-hero",
          chapterId: chapter.id,
          chapterSha256: hash(JSON.stringify(chapter)),
          assetId,
        });
        heroCount += 1;
      } else {
        const block = chapter.blocks?.[item.afterBlockIndex];
        if (!block || !visibleBlockText(block) || !validAlignments.has(item.align)) {
          throw new Error(`Invalid inline anchor for ${slug}/${item.id}.`);
        }
        const anchorSha256 = hash(JSON.stringify(block));
        if (item.anchorSha256 !== anchorSha256) {
          throw new Error(`Story anchor changed after planning for ${slug}/${item.id}.`);
        }
        inlineChapters.add(chapter.id);
        inlineOrdinalByChapter.set(chapter.id, inlineOrdinal);
        placements.push({
          kind: "after-block",
          chapterId: chapter.id,
          afterBlockIndex: item.afterBlockIndex,
          anchorSha256,
          assetId,
          placement: item.align === "plate" ? "plate" : "inline",
          align: item.align,
        });
        inlineCount += 1;
      }
      assetCount += 1;
      totalBytes += sourceStats.size;
    }
  }

  if (
    heroChapters.size !== story.chapters.length ||
    inlineChapters.size !== story.chapters.length ||
    assets.length !== placements.length ||
    retainedSceneIds.size !== approvedSceneMap.size ||
    [...approvedSceneMap.keys()].some((id) => !retainedSceneIds.has(id)) ||
    plan.summary?.chapters !== story.chapters.length ||
    plan.summary?.desiredInline !== assets.length - story.chapters.length ||
    plan.summary?.retainedInline !== retainedSceneIds.size ||
    plan.summary?.plannedInline !==
      assets.length - story.chapters.length - retainedSceneIds.size ||
    plan.summary?.plannedHeroes !== story.chapters.length
  ) {
    throw new Error(`Incomplete chapter coverage for ${slug}.`);
  }

  const manifest = {
    schemaVersion: 2,
    storySlug: slug,
    generation: {
      provider: "OpenAI",
      model: config.generation.model,
      quality: config.generation.quality,
      outputFormat: config.generation.format,
      outputCompression: config.generation.compression,
    },
    artDirection: {
      style: book.style,
      continuityReferenceUsed: true,
      continuityReferenceSha256,
    },
    assets,
    placements,
  };
  manifestJobs.push({
    destinationDirectory: path.join(projectRoot, "public", "stories", slug),
    manifest,
  });
}

if (
  heroCount !== 747 ||
  inlineCount !== 1_089 ||
  assetCount !== 1_836 ||
  copyJobs.length !== assetCount ||
  manifestJobs.length !== entries.length
) {
  throw new Error(
    `Incomplete curated set: ${heroCount} heroes, ${inlineCount} inline, ${assetCount} total.`,
  );
}

// Publishing has two phases. Every source, prompt, anchor, reference, quota,
// dimension, and global count is preflighted above before the public tree is
// touched. Content-addressed assets are copied first; all manifests are then
// staged before any manifest is atomically replaced.
for (const { sourcePath, destinationPath } of copyJobs) {
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await copyFile(sourcePath, destinationPath);
}

for (const job of manifestJobs) {
  await mkdir(job.destinationDirectory, { recursive: true });
  job.manifestPath = path.join(job.destinationDirectory, "ai-illustrations.json");
  job.temporaryPath = path.join(
    job.destinationDirectory,
    `.ai-illustrations.json.${process.pid}.tmp`,
  );
  await writeFile(job.temporaryPath, `${JSON.stringify(job.manifest, null, 2)}\n`);
}
for (const job of manifestJobs) {
  await rename(job.temporaryPath, job.manifestPath);
}

console.log(
  `Packaged ${assetCount} AI illustrations (${heroCount} heroes and ${inlineCount} inline scenes) across ${entries.length} books (${totalBytes} bytes).`,
);
