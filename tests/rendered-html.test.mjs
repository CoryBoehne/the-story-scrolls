import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";

const root = new URL("../", import.meta.url);
const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), "utf8"));

const featured = [
  ["alice-in-wonderland", "Alice’s Adventures in Wonderland"],
  ["the-wonderful-wizard-of-oz", "The Wonderful Wizard of Oz"],
];

test("static export presents the 24-story The Story Scrolls library", async () => {
  const [home, shared, registry] = await Promise.all([
    readFile(new URL("../dist/client/index.html", import.meta.url), "utf8"),
    readFile(new URL("../dist/client/shared/index.html", import.meta.url), "utf8"),
    readJson("config/curated-books.json"),
  ]);
  const homeText = home.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const curated = [...featured, ...registry.map(({ slug, title }) => [slug, title])];

  assert.equal(registry.length, 22);
  assert.equal(new Set(curated.map(([slug]) => slug)).size, 24);
  assert.match(home, /<title>The Story Scrolls — Stories Worth Wandering Into<\/title>/i);
  assert.match(home, /Welcome to The Story Scrolls/i);
  assert.match(home, /class="ss-library-loader/);
  assert.match(home, /role="progressbar"/);
  assert.match(home, /Skip introduction/i);
  assert.match(home, /Books become living scrolls/i);
  assert.match(home, /A first spark\. A lifelong love\./i);
  assert.match(home, /building blocks of writing/i);
  assert.match(home, /Turn the page/i);
  assert.doesNotMatch(home, /Choose a doorway|curated worlds|pages to turn/i);
  assert.match(home, /Create your own scroll/i);
  assert.doesNotMatch(home, /noindex/i);
  assert.match(shared, /<meta name="robots" content="noindex, nofollow"/i);

  for (const [slug, title] of curated) {
    assert.ok(homeText.includes(title), `Home catalog is missing ${title}.`);
    const page = await readFile(new URL(`../dist/client/stories/${slug}/index.html`, import.meta.url), "utf8");
    assert.match(page, new RegExp(`<title>${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} — The Story Scrolls<\\/title>`));
    assert.match(page, /ss-story-state--loading/);
    assert.match(page, /ss-story-transition__canvas--entry/);
  }
  assert.match(home, /family=Homemade\+Apple/);
  assert.match(home, /family=Caveat\+Brush/);
  assert.match(home, /family=IM\+FELL\+English\+SC/);
});

test("sitemap is exactly the public home, 24 curated stories, product, and policy routes", async () => {
  const [sitemap, registry] = await Promise.all([
    readFile(new URL("../public/sitemap.xml", import.meta.url), "utf8"),
    readJson("config/curated-books.json"),
  ]);
  const routes = [...sitemap.matchAll(/<loc>https:\/\/thestoryscrolls\.com([^<]+)<\/loc>/g)].map((match) => match[1]);
  const expected = [
    "/",
    ...featured.map(([slug]) => `/stories/${slug}/`),
    ...registry.map(({ slug }) => `/stories/${slug}/`),
    "/community/",
    "/create/",
    "/about/",
    "/privacy/",
    "/terms/",
  ];
  assert.equal(routes.length, 30);
  assert.equal(new Set(routes).size, 30);
  assert.deepEqual(new Set(routes), new Set(expected));
});

test("brand metadata and installable assets are complete", async () => {
  const [html, publicManifestRaw, exportedManifestRaw, favicon, socialCard] = await Promise.all([
    readFile(new URL("../dist/client/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/site.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../dist/client/site.webmanifest", import.meta.url), "utf8"),
    stat(new URL("../public/favicon.ico", import.meta.url)),
    stat(new URL("../public/og.png", import.meta.url)),
  ]);
  assert.match(html, /<link rel="canonical" href="https:\/\/thestoryscrolls\.com\/"\/>/);
  assert.match(html, /<meta property="og:site_name" content="The Story Scrolls"\/>/);
  assert.match(html, /<meta property="og:image:alt" content="[^"]*The Story Scrolls[^"]*"\/>/);
  assert.match(html, /<meta name="twitter:image:alt" content="[^"]*The Story Scrolls[^"]*"\/>/);
  const manifest = JSON.parse(publicManifestRaw);
  assert.deepEqual(JSON.parse(exportedManifestRaw), manifest);
  assert.equal(manifest.name, "The Story Scrolls");
  assert.equal(manifest.short_name, "The Story Scrolls");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.icons.length, 3);
  for (const [file, width, height] of [["favicon-32x32.png", 32, 32], ["apple-touch-icon.png", 180, 180], ["icon-192.png", 192, 192], ["icon-512.png", 512, 512], ["icon-maskable-512.png", 512, 512], ["og.png", 1200, 630]]) {
    const metadata = await sharp(await readFile(new URL(`../public/${file}`, import.meta.url))).metadata();
    assert.equal(metadata.format, "png");
    assert.equal(metadata.width, width);
    assert.equal(metadata.height, height);
  }
  assert.ok(favicon.size > 0);
  assert.ok(socialCard.size <= 1.5 * 1024 * 1024);
});

test("curated editions are complete, credited, and use each illustration once", async () => {
  const registry = await readJson("config/curated-books.json");
  const editions = [...featured.map(([slug]) => ({ slug })), ...registry];
  const publicRoot = new URL("../public/", import.meta.url);
  const hashPattern = /^[a-f0-9]{64}$/;
  const illuminatedSets = new Set();

  assert.equal(editions.length, 24);
  for (const expected of editions) {
    const story = await readJson(`public/stories/${expected.slug}/story.json`);
    assert.equal(story.slug, expected.slug);
    assert.equal(story.kind, "curated");
    assert.ok(story.chapters.length > 0, `${expected.slug} needs chapters.`);
    assert.match(story.source.textCatalogUrl, /^https:\/\/www\.gutenberg\.org\/ebooks\//);
    assert.match(story.source.textSha256, hashPattern);
    assert.equal(story.source.normalization.sourceBoilerplateRemoved, true);
    assert.doesNotMatch(JSON.stringify(story), /Project Gutenberg|projectGutenberg|gutenbergBoilerplate/i);
    assert.match(story.rights.status, /^public-domain/);
    assert.ok(story.intro.frames.length >= 1, `${expected.slug} needs an intro frame.`);
    const images = story.chapters.flatMap((chapter) => chapter.blocks.filter((block) => block.type === "image"));
    assert.ok(images.some((block) => block.placement === "inline"), `${expected.slug} needs inline art.`);
    const assetIds = story.assets.map((asset) => asset.id);
    const placed = [...story.intro.frames, ...images.map((block) => block.assetId)];
    assert.equal(new Set(assetIds).size, story.assets.length);
    assert.equal(new Set(placed).size, placed.length, `${expected.slug} repeats illustration placement.`);
    assert.deepEqual([...assetIds].sort(), [...placed].sort());
    const text = story.chapters.flatMap((chapter) => chapter.blocks.flatMap((block) => block.text ?? block.lines ?? [])).join("\n");
    assert.doesNotMatch(text, /PROJECT GUTENBERG|END OF (?:THE )?PROJECT GUTENBERG|TRANSCRIBER'?S NOTE/i);
    assert.equal(story.theme.illuminatedSet, undefined);
    assert.equal(story.theme.illuminatedManifest, undefined);
    assert.match(story.theme.illuminatedSetId, /^illuminatedletters:[a-z0-9][a-z0-9-]+$/);
    assert.ok(story.theme.illuminatedSetName.trim());
    assert.ok(story.theme.illuminatedSetVersion);
    assert.match(story.theme.illuminatedCatalogVersion, hashPattern);
    assert.match(story.theme.illuminatedGlyphsSha256, hashPattern);
    assert.equal(story.theme.illuminatedAttribution, "Illuminated Letters");
    assert.equal(story.theme.illuminatedDerivativePolicy, "used-initials-only-384px-opaque-paths");
    const usedInitials = new Set(story.chapters.flatMap((chapter) => {
      const firstParagraph = chapter.blocks.find((block) => block.type === "paragraph" && block.text?.trim());
      const character = String(chapter.firstLetter || firstParagraph?.text || "").trim().slice(0, 1).toLowerCase();
      return /^[a-z0-9]$/.test(character) ? [character] : [];
    }));
    assert.deepEqual(new Set(Object.keys(story.theme.illuminatedGlyphs)), usedInitials);
    for (const derivativePath of Object.values(story.theme.illuminatedGlyphs)) {
      assert.match(derivativePath, /^\/assets\/story-initials\/[a-f0-9]{32}\/[a-f0-9]{40}\.webp$/);
      const derivative = await readFile(new URL(derivativePath.slice(1), publicRoot));
      const metadata = await sharp(derivative).metadata();
      assert.equal(metadata.format, "webp");
      assert.ok((metadata.width ?? 0) <= 384);
      assert.ok((metadata.height ?? 0) <= 384);
      assert.equal(metadata.hasAlpha, true);
    }
    illuminatedSets.add(story.theme.illuminatedSetId);
    for (const asset of story.assets) {
      assert.match(asset.path, new RegExp(`^/stories/${expected.slug}/images/[^/]+\\.webp$`));
      assert.match(asset.sha256, hashPattern);
      assert.ok(asset.creator.trim());
      assert.equal(asset.publicDomain, true);
      const bytes = await readFile(new URL(asset.path.slice(1), publicRoot));
      assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256);
    }
  }
  assert.ok(illuminatedSets.size >= 4);
  await assert.rejects(readFile(new URL("assets/curated-illuminated/irish/a.webp", publicRoot)));
  await assert.rejects(readFile(new URL("stories/alice-in-wonderland/illuminated/a.webp", publicRoot)));
});

test("the library, reader, and transition retain the accessible continuous-reading foundation", async () => {
  const [library, loader, reader, transition, css, fitted] = await Promise.all([
    readFile(new URL("../app/platform/library-home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/platform/library-entry-experience.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/platform/story-reader.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/platform/story-transition.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/platform.css", import.meta.url), "utf8"),
    readFile(new URL("../app/platform/fitted-title.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(library, /LibraryEntryExperience/);
  assert.match(loader, /LOADER_MINIMUM_MS = 3_400/);
  assert.match(loader, /LOADER_SCROLL_CUE_MS = 21_650/);
  assert.match(loader, /LOADER_MESSAGES/);
  assert.match(loader, /RESIZE_DEBOUNCE_MS = 180/);
  assert.match(loader, /const columns: 1 \| 2 = width >= 820 \? 2 : 1/);
  assert.match(loader, /chunkItems\(FEATURED_STORIES/);
  assert.match(loader, /chunkItems\(CURATED_LIBRARY/);
  assert.match(reader, /ZOOM_MIN = 75/);
  assert.match(reader, /ZOOM_MAX = 400/);
  for (const font of [
    "homemade-apple",
    "caveat-brush",
    "classic-serif",
    "literata",
    "atkinson-hyperlegible",
    "nunito",
  ]) {
    assert.match(reader, new RegExp(`\\|? \\"${font}\\"`));
  }
  assert.match(reader, /storyscrolls-story-font/);
  assert.match(reader, /storyscrolls-high-contrast/);
  assert.match(reader, /storyscrolls-reading-zoom/);
  assert.match(reader, /ss-story-drawer/);
  assert.doesNotMatch(reader, /dangerouslySetInnerHTML/);
  assert.match(transition, /SCROLL_ENTRY_MANIFEST_URL/);
  assert.match(transition, /DESTINATION_SCROLL_MS/);
  assert.match(transition, /commitPhase\("handoff"\)[\s\S]*beginRouting\(\)/);
  assert.match(transition, /beginRouting\(true\)/);
  assert.doesNotMatch(transition, /ownedIntro|revealMode: "fade"/i);
  assert.match(fitted, /new ResizeObserver/);
  assert.match(fitted, /context\.measureText\(token\)/);
  assert.match(css, /dry-brush-mask\.svg/);
  assert.match(css, /text-align:\s*justify/);
  assert.match(css, /hyphens:\s*none/);
  assert.match(css, /@media \(max-width: 560px\)/);
});

test("library opening, book-to-scroll transition, and compact covers are packaged consistently", async () => {
  const [libraryManifest, entryManifest, coverManifest, readingArtBytes, writingArtBytes] = await Promise.all([
    readJson("public/assets/library-intro/manifest.json"),
    readJson("public/assets/scroll-entry/manifest.json"),
    readJson("public/assets/library-covers/manifest.json"),
    readFile(new URL("../public/assets/library-intro/reading-across-generations.webp", import.meta.url)),
    readFile(new URL("../public/assets/library-intro/learning-to-shape-stories.webp", import.meta.url)),
  ]);
  assert.equal(libraryManifest.frames.count, 263);
  assert.equal(libraryManifest.frames.openingEndIndex, 195);
  assert.equal(libraryManifest.frames.turnCount, 68);
  assert.equal(entryManifest.frames.count, 144);
  assert.equal(entryManifest.handoff.parchmentScale, 1.2);
  assert.equal(coverManifest.count, 24);
  assert.equal(coverManifest.assets.length, 24);
  assert.equal(new Set(coverManifest.assets.map((asset) => asset.slug)).size, 24);
  assert.ok(coverManifest.assets.every((asset) => asset.path.startsWith("/assets/library-covers/")));
  for (const artwork of [readingArtBytes, writingArtBytes]) {
    const metadata = await sharp(artwork).metadata();
    assert.equal(metadata.format, "webp");
    assert.ok((metadata.width ?? 0) >= 1_400);
    assert.ok((metadata.height ?? 0) >= 1_000);
    assert.ok(artwork.byteLength < 700 * 1024);
  }
});
