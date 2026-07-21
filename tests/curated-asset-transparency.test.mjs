import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";

const projectRoot = path.resolve(import.meta.dirname, "..");
const storyPath = path.join(
  projectRoot,
  "public/stories/the-story-of-king-arthur-and-his-knights/story.json",
);
test("King Arthur chapter ornament has transparent exterior rows", async () => {
  const story = JSON.parse(await readFile(storyPath, "utf8"));
  const asset = story.assets.find((candidate) => candidate.id === "art-018");
  assert.deepEqual(asset?.transparentPadding, { top: 10, right: 0, bottom: 12, left: 0 });
  assert.match(asset.path, /^\/stories\/the-story-of-king-arthur-and-his-knights\/images\/art-018-[a-f0-9]{12}\.webp$/);
  assert.equal(asset.path.includes(asset.sha256.slice(0, 12)), true);
  const imagePath = path.join(projectRoot, "public", asset.path.replace(/^\//, ""));

  const { data, info } = await sharp(imagePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 450);
  assert.equal(info.height, 75);
  assert.equal(info.channels, 4);

  const alphaAt = (x, y) => data[(y * info.width + x) * info.channels + 3];
  for (let y = 0; y < 10; y += 1) {
    for (let x = 0; x < info.width; x += 1) assert.equal(alphaAt(x, y), 0);
  }
  for (let y = info.height - 12; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) assert.equal(alphaAt(x, y), 0);
  }
  assert.equal(alphaAt(225, 11), 255);
  assert.equal(alphaAt(225, 60), 255);
});
