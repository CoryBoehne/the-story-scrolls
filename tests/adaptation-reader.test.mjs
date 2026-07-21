import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("community adaptations remain labeled and picture books render as image-led scrolls", async () => {
  const [reader, types, community, css] = await Promise.all([
    readFile(new URL("../app/platform/story-reader.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/platform/story-types.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/platform/community-library.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/platform.css", import.meta.url), "utf8"),
  ]);

  assert.match(types, /export type StoryAdaptation/);
  assert.match(types, /parseStoryAdaptation\(candidate\.adaptation\)/);
  assert.match(types, /adaptation: parseStoryAdaptation\(story\.adaptation\)/);
  assert.match(reader, /const isPictureBook = story\.adaptation\?\.audience\.format === "picture_book"/);
  assert.match(reader, /const showAiIllustrations = isPictureBook \|\| aiIllustrationsEnabled/);
  assert.match(reader, /data-story-format=\{isPictureBook \? "picture_book" : "prose"\}/);
  assert.match(reader, /hasAiIllustrations && !isPictureBook/);
  assert.match(reader, /adaptationEditionLabel\(story\)/);
  assert.match(reader, /adaptationCraftLabel\(story\)/);
  assert.match(reader, /storyAiIllustratorLabel\(story\)/);
  assert.match(reader, /Scroll created by \{story\.creatorName\}/);
  assert.match(reader, /Changes: \{readerFacingSourceText\(story\.source\.changeDescription\)\}/);
  assert.match(reader, /story\.source\?\.originalAuthor \? "Original author" : "Author"/);
  assert.match(reader, /<dt>Original source<\/dt>/);
  assert.match(reader, /<dt>Changes in this scroll<\/dt>/);
  assert.match(reader, /originalAuthor \|\| creatorName/);
  assert.match(types, /targetLanguage\?: string \| null/);
  assert.match(types, /qualityProfile\?: string \| null/);
  assert.match(community, /communityEditionLabel\(story\)/);
  assert.match(css, /\.ss-story\[data-story-format="picture_book"\] \.ss-story-chapter__body/);
  assert.match(css, /\.ss-story\[data-story-format="picture_book"\] \.ss-story-scroll \.ss-story-image figcaption/);
});

test("community typography honors authored choices without accepting raw CSS or glyph URLs", async () => {
  const [reader, types] = await Promise.all([
    readFile(new URL("../app/platform/story-reader.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/platform/story-types.ts", import.meta.url), "utf8"),
  ]);

  assert.match(types, /StoryGenerationPresentation/);
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
  assert.match(reader, /storyFontFrom\(story\.generation\?\.fontFamily\)/);
  assert.match(reader, /savedFont && savedFont in STORY_FONTS/);
  assert.match(reader, /generation\.fontFamily === "homemade-apple"/);
  assert.match(reader, /\^illuminatedletters:\[a-z0-9\]/);
  assert.match(reader, /storyTypographyLabel\(story\)/);
  assert.match(reader, /<dt>Reading design<\/dt>/);
  assert.match(reader, /event\.currentTarget\.hidden = true/);
  assert.match(reader, /classList\.add\("is-fallback"\)/);
  assert.match(reader, /<span>\{letter\}<\/span>/);
  assert.match(reader, /normalizeIlluminatedGlyphs\(generation\?\.illuminatedGlyphs\)/);
  assert.match(reader, /\/assets\\\/story-initials/);
  assert.match(reader, /\/media\\\/community/);
  assert.doesNotMatch(reader, /communityIlluminatedSet/);
  assert.doesNotMatch(reader, /\/assets\/curated-illuminated/);
  assert.doesNotMatch(reader, /fontFamily\s*:\s*String\(/);
  assert.doesNotMatch(reader, /illuminatedSetId[^\n]{0,120}(?:src|illuminatedSet:)/);
});
