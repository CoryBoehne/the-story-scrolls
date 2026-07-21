import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "..");
const removedStorySlug = ["the", "wandering", "inn"].join("-");
const legacyTerms = [
  "The " + "Wandering " + "Inn",
  "pirate" + "aba",
  "Storybook " + "Scrolls",
  "wandering" + "inn.com",
  "/api/chapter-" + "catalog",
].map((value) => value.toLowerCase());

async function textFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await textFiles(absolute));
    } else if (/\.(?:[cm]?[jt]sx?|json|css|html|xml|txt)$/i.test(entry.name)) {
      files.push(absolute);
    }
  }
  return files;
}

async function assertNoLegacyText(roots) {
  for (const root of roots) {
    for (const file of await textFiles(root)) {
      const text = (await readFile(file, "utf8")).toLowerCase();
      for (const term of legacyTerms) {
        assert.equal(text.includes(term), false, `${path.relative(projectRoot, file)} retains legacy reference: ${term}`);
      }
    }
  }
}

test("clean public fork contains only the 24 curated stories and no legacy runtime or build surface", async () => {
  const registry = JSON.parse(await readFile(path.join(projectRoot, "config", "curated-books.json"), "utf8"));
  const curated = ["alice-in-wonderland", "the-wonderful-wizard-of-oz", ...registry.map((book) => book.slug)];
  assert.equal(curated.length, 24);
  assert.equal(new Set(curated).size, 24);

  for (const removedPath of [
    "app/reader-app.tsx",
    "app/entry-experience.tsx",
    "app/early-volume-recaps.ts",
    "app/chapter-content-rules.js",
    `app/stories/${removedStorySlug}`,
    "server/catalog-server.mjs",
    "scripts/build_references.py",
    "public/data/chapters.json",
    "public/assets/intro-opening.jpg",
    "public/assets/intro-frames",
    "public/assets/illuminated",
  ]) {
    await assert.rejects(access(path.join(projectRoot, removedPath)), `${removedPath} must not be part of the clean fork.`);
  }

  await assertNoLegacyText([
    path.join(projectRoot, "app"),
    path.join(projectRoot, "server"),
    path.join(projectRoot, "config"),
    path.join(projectRoot, "scripts"),
    path.join(projectRoot, "dist", "client"),
  ]);

  const exportedStoryDirs = await readdir(path.join(projectRoot, "dist", "client", "stories"), { withFileTypes: true });
  const exportedSlugs = exportedStoryDirs.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  assert.deepEqual(new Set(exportedSlugs), new Set(curated));
});
