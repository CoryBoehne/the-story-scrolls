import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

const projectRoot = path.resolve(import.meta.dirname, "..");
const assetRoot = path.join(projectRoot, "public", "assets", "scroll-entry");
const manifestPath = path.join(assetRoot, "manifest.json");

const frameName = (index) => `frame-${String(index).padStart(3, "0")}.webp`;

test("story transition manifest preserves the deduplicated source timeline and phases", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const duplicateSourceIndexes = Array.from({ length: 36 }, (_, index) => 1 + index * 5);
  const sourceFrameIndexes = Array.from({ length: 180 }, (_, index) => index)
    .filter((index) => !duplicateSourceIndexes.includes(index));

  assert.equal(manifest.version, 1);
  assert.deepEqual(manifest.source, {
    count: 180,
    fps: 30,
    effectiveFps: 24,
    width: 2160,
    height: 3840,
    duplicateSourceIndexes,
  });
  assert.equal(manifest.frames.count, 144);
  assert.equal(manifest.frames.filePattern, "frame-{index:000}.webp");
  assert.deepEqual(manifest.frames.sourceFrameIndexes, sourceFrameIndexes);

  const phaseSources = {
    bookHold: [0, 15],
    pageTurn: [17, 94],
    scrollReveal: [95, 167],
    parchmentHandoff: [168, 179],
  };
  const phases = Object.entries(phaseSources);
  for (const [position, [name, [sourceStartIndex, sourceEndIndex]]] of phases.entries()) {
    const phase = manifest.frames.phases[name];
    assert.ok(phase, `${name} phase must exist`);
    assert.equal(phase.sourceStartIndex, sourceStartIndex);
    assert.equal(phase.sourceEndIndex, sourceEndIndex);
    assert.equal(sourceFrameIndexes[phase.startIndex], sourceStartIndex);
    assert.equal(sourceFrameIndexes[phase.endIndex], sourceEndIndex);
    assert.ok(phase.startIndex <= phase.endIndex);
    if (position > 0) {
      const previous = manifest.frames.phases[phases[position - 1][0]];
      assert.equal(phase.startIndex, previous.endIndex + 1);
    }
  }

  const markerSources = {
    sequenceStart: 0,
    pageLiftStart: 17,
    illustratedFlipStart: 27,
    scrollPlateRevealed: 95,
    scrollZoomStart: 97,
    cleanParchmentStart: 168,
    sequenceEnd: 179,
  };
  for (const [name, sourceIndex] of Object.entries(markerSources)) {
    const marker = manifest.frames.markers[name];
    assert.ok(marker, `${name} marker must exist`);
    assert.equal(marker.sourceIndex, sourceIndex);
    assert.equal(sourceFrameIndexes[marker.index], sourceIndex);
  }

  assert.equal(manifest.handoff.startIndex, manifest.frames.phases.parchmentHandoff.startIndex);
  assert.equal(manifest.handoff.endIndex, manifest.frames.phases.parchmentHandoff.endIndex);
  assert.equal(manifest.handoff.parchmentScale, 1.2);
  assert.deepEqual(manifest.handoff.sequenceExposure, { start: 0.892, end: 0.936 });
  assert.equal(manifest.handoff.bridgeSourceYOffsetRatio, 1640 / 3840);
  assert.equal(manifest.handoff.bridgeGrade.slope.length, 3);
  assert.equal(manifest.handoff.bridgeGrade.intercept.length, 3);
});

test("story transition frame variants are complete WebP sequences with exact byte totals", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const expectedVariants = new Map([
    ["960w", { width: 960, height: 1707, directory: "frames-960" }],
    ["1440w", { width: 1440, height: 2560, directory: "frames-1440" }],
  ]);

  assert.equal(manifest.variants.length, expectedVariants.size);
  for (const variant of manifest.variants) {
    const expected = expectedVariants.get(variant.id);
    assert.ok(expected, `unexpected transition variant ${variant.id}`);
    assert.equal(variant.width, expected.width);
    assert.equal(variant.height, expected.height);
    assert.equal(variant.quality, 80);
    assert.equal(variant.basePath, `/assets/scroll-entry/${expected.directory}`);
    assert.equal(variant.filePattern, "frame-{index:000}.webp");

    const directory = path.join(assetRoot, expected.directory);
    const files = (await readdir(directory)).sort();
    const expectedFiles = Array.from({ length: manifest.frames.count }, (_, index) => frameName(index));
    assert.deepEqual(files, expectedFiles);

    let totalBytes = 0;
    for (const file of files) {
      const filePath = path.join(directory, file);
      const [metadata, fileStat] = await Promise.all([
        sharp(filePath).metadata(),
        stat(filePath),
      ]);
      assert.equal(metadata.format, "webp", `${variant.id}/${file} must be WebP`);
      assert.equal(metadata.width, variant.width, `${variant.id}/${file} width`);
      assert.equal(metadata.height, variant.height, `${variant.id}/${file} height`);
      totalBytes += fileStat.size;
    }
    assert.equal(totalBytes, variant.bytes);
  }
});

test("story transition parchment bridges exist and match their manifest variants", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const frameVariants = new Map(manifest.variants.map((variant) => [variant.id, variant]));

  assert.equal(manifest.handoff.bridgeVariants.length, frameVariants.size);
  for (const bridge of manifest.handoff.bridgeVariants) {
    const variant = frameVariants.get(bridge.id);
    assert.ok(variant, `bridge ${bridge.id} must map to a frame variant`);
    assert.equal(bridge.width, variant.width);
    assert.equal(bridge.height, variant.height);
    assert.equal(bridge.url, `/assets/scroll-entry/bridge-${variant.width}.webp`);

    const filePath = path.join(projectRoot, "public", bridge.url.slice(1));
    const [metadata, fileStat] = await Promise.all([
      sharp(filePath).metadata(),
      stat(filePath),
    ]);
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, bridge.width);
    assert.equal(metadata.height, bridge.height);
    assert.equal(fileStat.size, bridge.bytes);
  }
});

test("every library, community, and newly-created story entry opts into the transition", async () => {
  const [library, community, studio] = await Promise.all([
    readFile(path.join(projectRoot, "app", "platform", "library-entry-experience.tsx"), "utf8"),
    readFile(path.join(projectRoot, "app", "platform", "community-library.tsx"), "utf8"),
    readFile(path.join(projectRoot, "app", "platform", "create-studio.tsx"), "utf8"),
  ]);
  const openingTags = (source) => source.match(/<(?:a|Link)\b[^>]*>/gs) ?? [];
  const storyEntries = [
    ...openingTags(library).filter((tag) => (
      /href=\{story\.href\}/.test(tag)
      || /href=\{`\/stories\/\$\{book\.slug\}\//.test(tag)
      || /href=\{story\.href \?\? `\/shared\//.test(tag)
    )),
    ...openingTags(community).filter((tag) => /href=\{`\/shared\//.test(tag)),
    ...openingTags(studio).filter((tag) => /href=\{created\.url \|\| `\/shared\//.test(tag)),
  ];

  assert.equal(storyEntries.length, 4);
  for (const tag of storyEntries) assert.match(tag, /\bdata-story-entry\b/);
});

test("every story enters through a stable reading-direction paper reveal", async () => {
  const [reader, transition, platformCss] = await Promise.all([
    readFile(path.join(projectRoot, "app", "platform", "story-reader.tsx"), "utf8"),
    readFile(path.join(projectRoot, "app", "platform", "story-transition.tsx"), "utf8"),
    readFile(path.join(projectRoot, "app", "platform.css"), "utf8"),
  ]);

  assert.match(reader, /<StoryTitlePage\b/);
  assert.match(
    reader,
    /<div\s+[^>]*className="ss-story-transition__arrival-spacer"[^>]*\/>\s*<div ref=\{paperRef\} className="ss-story-paper">/s,
    "the temporary blank lead-in must sit before the paper so collapsing it preserves texture phase",
  );
  assert.match(reader, /spacerRef:\s*arrivalSpacerRef/);
  assert.doesNotMatch(reader, /<StoryIntro\b/);
  assert.match(transition, /const beginRouting = useCallback\(\(immediateReveal = false\)/);

  const finishRevealStart = transition.indexOf("const finishReveal = useCallback");
  const beginRoutingStart = transition.indexOf("const beginRouting = useCallback", finishRevealStart);
  assert.ok(finishRevealStart >= 0, "finishReveal must exist");
  assert.ok(beginRoutingStart > finishRevealStart, "beginRouting must follow finishReveal");
  const finishReveal = transition.slice(finishRevealStart, beginRoutingStart);
  const revealStart = finishReveal.indexOf("const reveal = (now: number) =>");
  assert.ok(revealStart >= 0, "finishReveal must have a frame-driven reveal loop");
  const revealLoop = finishReveal.slice(revealStart);
  const playTransitionStart = transition.indexOf("const playTransition = useCallback");
  const skipTransitionStart = transition.indexOf("const skipTransition = useCallback", playTransitionStart);
  const playTransition = transition.slice(playTransitionStart, skipTransitionStart);

  assert.doesNotMatch(transition, /movingContent/);
  assert.doesNotMatch(
    transition,
    /cover\.style\.transform\s*=\s*`translate3d/,
    "moving the final bitmap would break its exact texture phase with the live paper",
  );
  assert.match(transition, /handoffTextureGeometry\(/);
  assert.match(transition, /destinationTextureGeometry\(/);
  assert.match(finishReveal, /setParchmentRevealEdge\(/);
  assert.match(finishReveal, /alignSurfaceTextureToHandoff\(surfaceTarget, startGeometry\)/);
  assert.doesNotMatch(transition, /bridgeRef|bridgeReadyRef|bridgeUrl|setBridgeUrl/);
  assert.doesNotMatch(transition, /ss-story-transition__bridge/);
  assert.doesNotMatch(transition, /parchmentRef|ss-story-transition__parchment/);
  assert.match(transition, /entryHandoffPaintedRef/);
  assert.match(transition, /setHandoffOpacity\(/);
  assert.doesNotMatch(transition, /ENTRY_HANDOFF_TONE_START_PROGRESS|ENTRY_HANDOFF_MATCH_EXPOSURE/);
  assert.match(playTransition, /setEntryExposure\(sequenceExposure\)/);
  assert.match(playTransition, /setEntryExposure\(1\)/);
  assert.match(playTransition, /entryHandoffPaintedRef\.current = drewHandoff/);
  assert.match(playTransition, /entryManifest\.frames\.count - 1,\s*true,/s);
  assert.match(playTransition, /transitionEndAt \+ HANDOFF_FRAME_WAIT_MS/);
  assert.doesNotMatch(playTransition, /directHandoff|bridgeReadyRef\.current/);
  assert.doesNotMatch(
    playTransition,
    /index >= cleanHandoffStart \? 1 : 0/,
    "the normal video tail must not expose a full-screen parchment plate",
  );
  assert.match(finishReveal, /revealFeather/);
  assert.doesNotMatch(finishReveal, /repeatedTextureGeometry|textureRepeatCountBefore/);
  assert.doesNotMatch(finishReveal, /setVisualOpacity\(0, 0, 1 - smoothstep/);
  assert.match(finishReveal, /const spacerHeight\s*=/);
  assert.match(
    finishReveal,
    /spacerTarget\?\.getBoundingClientRect\(\)\.height/,
    "the scroll distance must come from the rendered lead-in, including responsive resize",
  );
  assert.match(
    revealLoop,
    /const remainingSpacerHeight\s*=\s*spacerHeight\s*\*\s*\(1\s*-\s*smoothstep\(/,
    "each reveal frame must collapse the lead-in in the reading direction",
  );
  assert.match(
    revealLoop,
    /spacerTarget\?\.style\.setProperty\(\s*"--ss-story-arrival-height",\s*`\$\{remainingSpacerHeight\}px`/s,
    "the reveal loop must move the entire following paper in normal layout",
  );
  assert.doesNotMatch(revealLoop, /window\.scrollTo\(/);
  assert.match(revealLoop, /window\.requestAnimationFrame\(reveal\)/);
  assert.match(transition, /phaseRef\.current === "revealing"/);
  const legacyPattern = new RegExp(["ownedIntro", ["the", "wandering", "inn"].join("-")].join("|"), "i");
  assert.doesNotMatch(transition, legacyPattern);

  const spacerRule = platformCss.match(/\.ss-story-transition__arrival-spacer\s*\{([^}]*)\}/s)?.[1] ?? "";
  assert.match(spacerRule, /height:\s*0/);
  const stableRootRule = platformCss.match(/(?:^|\n)html\s*\{([^}]*)\}/s)?.[1] ?? "";
  assert.match(stableRootRule, /scrollbar-gutter:\s*stable both-edges/);
  assert.match(platformCss, /@media \(max-width: 560px\)[\s\S]*?html\s*\{[^}]*scrollbar-gutter:\s*stable;/);
  assert.match(transition, /document\.documentElement\.getBoundingClientRect\(\)/);
  assert.match(transition, /viewportLeft:\s*rootRect\.left/);
  assert.doesNotMatch(
    platformCss,
    /html\.ss-story-transition-active \.ss-story\s*\{[^}]*background-color:\s*#c39c5e/s,
    "the destination route must not flash to a full-screen tan fallback during handoff",
  );
  assert.doesNotMatch(platformCss, /\.ss-story-transition__bridge\s*\{/);
  assert.match(
    platformCss,
    /background-position:\s*var\(--ss-story-paper-transition-position,\s*center top\)/,
    "the live paper must accept handoff-aligned background phase",
  );
  assert.match(
    platformCss,
    /background-size:\s*var\(\s*--ss-story-paper-transition-size,/,
    "the live paper must accept the handoff-aligned texture size",
  );
  const activeSpacerRule = platformCss.match(
    /html\.ss-story-transition-active \.ss-story-transition__arrival-spacer\s*\{([^}]*)\}/s,
  )?.[1] ?? "";
  assert.match(activeSpacerRule, /--ss-story-arrival-height/);
  assert.match(activeSpacerRule, /100svh/);
  assert.match(activeSpacerRule, /--ss-stable-vh/);
  assert.match(activeSpacerRule, /min-height:\s*0/);

  const revealingSkipRule = platformCss.match(
    /\.ss-story-transition\[data-phase="revealing"\] \.ss-story-transition__skip\s*\{([^}]*)\}/s,
  )?.[1] ?? "";
  assert.match(revealingSkipRule, /opacity:\s*0/);
  assert.match(revealingSkipRule, /pointer-events:\s*none/);
  assert.match(revealingSkipRule, /visibility:\s*hidden/);

  assert.doesNotMatch(platformCss, /\.ss-story-transition__parchment\s*\{/);
  assert.doesNotMatch(
    platformCss,
    /\.ss-story-transition\[data-phase="revealing"\][^{]*\{[^}]*(?:background-position|background-size)/s,
  );
});

test("library page cadence uses half-distance holds and turns", async () => {
  const source = await readFile(
    path.join(projectRoot, "app", "platform", "library-entry-experience.tsx"),
    "utf8",
  );

  assert.match(source, /const PAGE_HOLD_VH = 0\.21;/);
  assert.match(source, /const PAGE_TURN_VH = 0\.33;/);
  assert.match(source, /const holdDistance = Math\.max\(height \* PAGE_HOLD_VH, 145\);/);
  assert.match(source, /const turnDistance = Math\.max\(height \* PAGE_TURN_VH, 215\);/);
});
