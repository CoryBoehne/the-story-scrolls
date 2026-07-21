import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("image texture is half strength and uses a strict fully-opaque alpha mask", async () => {
  const [component, styles, reader, library] = await Promise.all([
    readFile(new URL("../app/platform/image-texture-overlay.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/platform.css", import.meta.url), "utf8"),
    readFile(new URL("../app/platform/story-reader.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/platform/library-entry-experience.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(component, /pixels\.data\[index\] === 255/);
  assert.match(component, /pixels\.data\[index - 3\] = 0/);
  assert.match(component, /pixels\.data\[index - 2\] = 0/);
  assert.match(component, /pixels\.data\[index - 1\] = 0/);
  assert.match(component, /pixels\.data\[index\] = opaque \? 255 : 0/);
  assert.doesNotMatch(component, /fullyOpaque/);
  assert.match(component, /"maskImage" in style \|\| "webkitMaskImage" in style/);
  assert.match(component, /reader\.readAsDataURL\(blob\)/);
  assert.doesNotMatch(component, /URL\.createObjectURL|URL\.revokeObjectURL/);
  assert.match(component, /omit the treatment instead of painting it[\s\S]*across transparency/);
  assert.match(component, /querySelector<HTMLImageElement>\(":scope > img"\)/);
  assert.match(component, /image\.addEventListener\("load", prepare\)/);
  assert.doesNotMatch(component, /<img/);
  assert.match(styles, /--ss-image-texture-strength:\s*0\.5/);
  assert.match(styles, /\.ss-image-texture\.is-ready\s*\{[\s\S]*?opacity:\s*var\(--ss-image-texture-strength\)/);
  assert.match(styles, /\.ss-image-texture\.is-alpha-masked\s*\{[\s\S]*?mask:\s*var\(--ss-image-opaque-mask\) center \/ var\(--ss-image-mask-fit, contain\)/);
  assert.doesNotMatch(styles, /\.ss-story-image__canvas::after/);
  assert.match(reader, /<ImageTextureOverlay source=\{asset\.path\} fit=\{isChapterHero \? "cover" : "contain"\} \/>/);
  assert.doesNotMatch(reader, /assumeOpaque/);
  assert.match(library, /ImageTextureOverlay source="\/assets\/library-intro\/reading-across-generations\.webp"/);
  assert.match(library, /ImageTextureOverlay source="\/assets\/library-intro\/learning-to-shape-stories\.webp"/);
  assert.equal((library.match(/<ImageTextureOverlay source=/g) ?? []).length, 5);
});
