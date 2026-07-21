import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

const projectRoot = process.cwd();
const readJson = async (...segments) =>
  JSON.parse(await readFile(path.join(projectRoot, ...segments), "utf8"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

test("curated AI illustration catalog contains exactly the 24 public-domain books with distinct styles", async () => {
  const catalog = await readJson("config", "ai-illustrations.json");
  const books = Object.entries(catalog.books);
  const scenes = books.flatMap(([, book]) => book.scenes);

  assert.equal(catalog.generation.model, "gpt-image-2");
  assert.equal(catalog.generation.quality, "low");
  assert.equal(books.length, 24);
  assert.ok(scenes.length >= 42);
  assert.equal(new Set(books.map(([slug]) => slug)).size, 24);
  assert.equal(new Set(books.map(([, book]) => book.style)).size, books.length);
  assert.ok(books.filter(([, book]) => book.referenceImage).length >= 6);
});

test("packaged AI manifests are content-addressed and pinned to story anchors", async () => {
  const catalog = await readJson("config", "ai-illustrations.json");
  let manifestCount = 0;
  let assetCount = 0;
  let heroCount = 0;
  let inlineCount = 0;

  for (const [slug, book] of Object.entries(catalog.books)) {
    const [story, plan] = await Promise.all([
      readJson("public", "stories", slug, "story.json"),
      readJson(
        "art-direction",
        "ai-illustrations",
        "chapter-plans",
        `${slug}.json`,
      ),
    ]);
    const manifest = await readJson(
      "public",
      "stories",
      slug,
      "ai-illustrations.json",
    );
    assert.equal(manifest.storySlug, slug);
    assert.equal(manifest.generation.model, "gpt-image-2");
    assert.equal(manifest.generation.quality, "low");
    assert.equal(manifest.artDirection.style, book.style);
    assert.equal(manifest.schemaVersion, 2);
    assert.equal(manifest.assets.length, manifest.placements.length);
    assert.equal(
      manifest.assets.length,
      plan.summary.desiredInline + plan.summary.plannedHeroes,
    );
    assert.equal(
      story.assets?.some((asset) => asset.type === "ai-illustration") ?? false,
      false,
      `${slug} must keep generated assets out of its provenance-controlled story.json`,
    );

    const chapterMap = new Map(story.chapters.map((chapter) => [chapter.id, chapter]));
    for (const asset of manifest.assets) {
      assert.match(
        asset.path,
        new RegExp(`^/stories/${slug}/ai-images/[a-z0-9-]+-[a-f0-9]{12}\\.webp$`),
      );
      const diskPath = path.join(projectRoot, "public", asset.path);
      const [buffer, stats, metadata] = await Promise.all([
        readFile(diskPath),
        stat(diskPath),
        sharp(diskPath).metadata(),
      ]);
      assert.equal(stats.size, asset.bytes);
      assert.equal(sha256(buffer), asset.sha256);
      assert.equal(asset.path.includes(asset.sha256.slice(0, 12)), true);
      assert.equal(metadata.format, "webp");
      assert.equal(metadata.width, asset.width);
      assert.equal(metadata.height, asset.height);
      assert.equal(asset.width % 16, 0);
      assert.equal(asset.height % 16, 0);
      assert.ok(asset.width * asset.height >= 655_360);
    }

    const assetMap = new Map(manifest.assets.map((asset) => [asset.id, asset]));
    const placedAssets = new Set();
    const heroChapters = new Set();
    const sceneChapters = new Set();
    const heroAssetByChapter = new Map();
    const inlineAssetsByChapter = new Map();
    for (const placement of manifest.placements) {
      const chapter = chapterMap.get(placement.chapterId);
      assert.ok(chapter, `${slug}/${placement.chapterId} must exist`);
      assert.equal(placedAssets.has(placement.assetId), false);
      placedAssets.add(placement.assetId);
      const asset = assetMap.get(placement.assetId);
      assert.ok(asset, `${slug}/${placement.assetId} must reference an asset`);
      if (placement.kind === "chapter-hero") {
        assert.equal(asset.width, 1344);
        assert.equal(asset.height, 576);
        assert.equal(placement.chapterSha256, sha256(JSON.stringify(chapter)));
        assert.equal(heroChapters.has(chapter.id), false);
        heroChapters.add(chapter.id);
        heroAssetByChapter.set(chapter.id, placement.assetId);
        heroCount += 1;
        continue;
      }
      assert.equal(placement.kind, "after-block");
      const block = chapter.blocks[placement.afterBlockIndex];
      assert.ok(block, `${slug}/${placement.chapterId}:${placement.afterBlockIndex} must exist`);
      assert.equal(placement.anchorSha256, sha256(JSON.stringify(block)));
      sceneChapters.add(chapter.id);
      const chapterAssets = inlineAssetsByChapter.get(chapter.id) ?? [];
      chapterAssets.push(placement.assetId);
      inlineAssetsByChapter.set(chapter.id, chapterAssets);
      inlineCount += 1;
    }
    assert.equal(placedAssets.size, manifest.assets.length);
    assert.equal(heroChapters.size, story.chapters.length);
    assert.equal(sceneChapters.size, story.chapters.length);
    for (const chapterPlan of plan.chapters) {
      assert.equal(
        heroAssetByChapter.get(chapterPlan.id),
        `ai-${chapterPlan.hero.id}`,
      );
      assert.deepEqual(
        (inlineAssetsByChapter.get(chapterPlan.id) ?? []).sort(),
        chapterPlan.inline.map((scene) => `ai-${scene.id}`).sort(),
      );
      for (const scene of chapterPlan.inline.filter((item) => item.status === "planned")) {
        const asset = assetMap.get(`ai-${scene.id}`);
        assert.ok(asset);
        assert.equal(asset.width, 1024);
        assert.equal(asset.height, 640);
      }
    }
    manifestCount += 1;
    assetCount += manifest.assets.length;
  }

  assert.equal(manifestCount, 24);
  assert.equal(assetCount, 1_836);
  assert.equal(heroCount, 747);
  assert.equal(inlineCount, 1_089);
});

test("reader routes load sidecar art and the setting is persisted without intro injection", async () => {
  const [reader, styles, genericRoute, aliceRoute, ozRoute] = await Promise.all([
    readFile(path.join(projectRoot, "app", "platform", "story-reader.tsx"), "utf8"),
    readFile(path.join(projectRoot, "app", "platform.css"), "utf8"),
    readFile(path.join(projectRoot, "app", "stories", "[slug]", "page.tsx"), "utf8"),
    readFile(path.join(projectRoot, "app", "stories", "alice-in-wonderland", "page.tsx"), "utf8"),
    readFile(path.join(projectRoot, "app", "stories", "the-wonderful-wizard-of-oz", "page.tsx"), "utf8"),
  ]);
  assert.match(reader, /storyscrolls-ai-illustrations/);
  assert.match(reader, /AI illustrations/);
  assert.match(reader, /\[aiIllustrationsEnabled, setAiIllustrationsEnabled\] = useState\(true\)/);
  assert.match(reader, /setAiIllustrationsEnabled\(savedAiIllustrations !== "false"\)/);
  assert.match(reader, /data-ai-illustration/);
  assert.match(reader, /aiIllustrationsEnabled\s*\?/);
  assert.match(reader, /Array\.isArray\(raw\.assets\)/);
  assert.match(reader, /item\.kind === "image"/);
  assert.match(reader, /asset\?\.type === "ai-illustration" && !showAiIllustrations/);
  assert.match(reader, /mode === "curated"\s*\? story\.assets\.find/);
  assert.match(reader, /crypto\.subtle\.digest/);
  assert.match(reader, /anchor === placement\.anchorSha256/);
  assert.match(reader, /schemaVersion !== 1 && schemaVersion !== 2/);
  assert.match(reader, /placement\.kind === "chapter-hero"/);
  assert.match(reader, /anchor === placement\.chapterSha256/);
  assert.match(reader, /asset\.path\.endsWith\(`/);
  assert.match(reader, /asset\.width !== 1344/);
  assert.match(reader, /asset\.height !== 576/);
  assert.match(reader, /<\/header>\s*\{resolvedChapterHero \? \(/);
  assert.match(reader, /loading=\{priority \? "eager" : "lazy"\}/);
  assert.match(reader, /decoding="async"/);
  assert.match(reader, /data-reader-anchor/);
  assert.match(reader, /block\.placement === "chapter-hero"/);
  assert.match(reader, /resolvedChapterHero/);
  assert.match(styles, /\.ss-story-image--chapter-hero/);
  assert.match(styles, /aspect-ratio:\s*21\s*\/\s*9/);
  assert.match(
    styles,
    /\.ss-story-image:not\(\.ss-story-image--plate\):not\(\.ss-story-image--chapter-hero\)/,
  );
  for (const route of [genericRoute, aliceRoute, ozRoute]) {
    assert.match(route, /aiSourceUrl=/);
    assert.match(route, /ai-illustrations\.json/);
  }
});
