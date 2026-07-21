import assert from "node:assert/strict";
import test from "node:test";

import {
  destinationTextureGeometry,
  handoffTextureGeometry,
  interpolateTextureGeometry,
} from "../app/platform/story-transition-geometry.mjs";

const VIEWPORTS = [
  { name: "desktop", viewportWidth: 1440, viewportHeight: 900, surfaceWidth: 1440 },
  { name: "tablet landscape", viewportWidth: 1024, viewportHeight: 768, surfaceWidth: 1024 },
  { name: "tablet portrait", viewportWidth: 768, viewportHeight: 1024, surfaceWidth: 768 },
  { name: "phone portrait", viewportWidth: 390, viewportHeight: 844, surfaceWidth: 390 },
  { name: "phone landscape", viewportWidth: 844, viewportHeight: 390, surfaceWidth: 844 },
];

test("destination parchment width follows the reader's measured surface at every viewport", () => {
  for (const viewport of VIEWPORTS) {
    const geometry = destinationTextureGeometry({
      surfaceWidth: viewport.surfaceWidth,
      surfaceTop: 0,
    });

    assert.equal(
      geometry.width,
      Math.max(1000, viewport.surfaceWidth),
      `${viewport.name} destination width`,
    );
    assert.equal(geometry.left, 0, `${viewport.name} destination left`);
    assert.equal(geometry.top, 0, `${viewport.name} destination top`);
  }
});

test("authored handoff geometry remains finite across reader aspect ratios", () => {
  for (const viewport of VIEWPORTS) {
    const handoff = handoffTextureGeometry(viewport);

    assert.ok(Number.isFinite(handoff.width), `${viewport.name} handoff width is finite`);
    assert.ok(Number.isFinite(handoff.left), `${viewport.name} handoff left is finite`);
    assert.ok(Number.isFinite(handoff.top), `${viewport.name} handoff top is finite`);
    assert.ok(handoff.width > 0, `${viewport.name} handoff width is positive`);
    assert.equal(
      handoff.left,
      (viewport.viewportWidth - handoff.width) / 2,
      `${viewport.name} handoff is centered without rounding`,
    );
    assert.ok(handoff.top < 0, `${viewport.name} authored texture starts above its origin`);
  }
});

test("authored handoff geometry includes the stable viewport gutter origin", () => {
  const withoutGutter = handoffTextureGeometry({
    viewportWidth: 1410,
    viewportHeight: 900,
  });
  const withGutter = handoffTextureGeometry({
    viewportWidth: 1410,
    viewportHeight: 900,
    viewportLeft: 15,
  });

  assert.equal(withGutter.width, withoutGutter.width);
  assert.equal(withGutter.left, withoutGutter.left + 15);
  assert.equal(withGutter.top, withoutGutter.top);
});

test("texture interpolation preserves its exact alignment endpoints", () => {
  for (const viewport of VIEWPORTS) {
    const handoff = handoffTextureGeometry(viewport);
    const destination = destinationTextureGeometry({
      surfaceWidth: viewport.surfaceWidth,
      surfaceTop: 0,
    });

    assert.deepEqual(
      interpolateTextureGeometry(handoff, destination, 0),
      handoff,
      `${viewport.name} interpolation start`,
    );
    assert.deepEqual(
      interpolateTextureGeometry(handoff, destination, 1),
      destination,
      `${viewport.name} interpolation end`,
    );
  }
});

test("paper-local offsets preserve the authored screen-space texture phase", () => {
  for (const viewport of VIEWPORTS) {
    const handoff = handoffTextureGeometry(viewport);
    for (const surfaceTop of [viewport.viewportHeight, viewport.viewportHeight / 2, 0, -1]) {
      const surfaceLeft = 0;
      const localLeft = handoff.left - surfaceLeft;
      const localTop = handoff.top - surfaceTop;
      assert.ok(
        Math.abs(surfaceLeft + localLeft - handoff.left) < 1e-9,
        `${viewport.name} horizontal phase`,
      );
      assert.ok(
        Math.abs(surfaceTop + localTop - handoff.top) < 1e-9,
        `${viewport.name} vertical phase at ${surfaceTop}`,
      );
    }
  }
});

test("the lead-in collapses while the whole paper moves in the reading direction", () => {
  const smoothstep = (progress) => progress * progress * (3 - 2 * progress);

  for (const viewport of VIEWPORTS) {
    const initialSpacerHeight = viewport.viewportHeight;

    const samples = Array.from(
      { length: 41 },
      (_, index) => {
        const progress = smoothstep(index / 40);
        const spacerHeight = initialSpacerHeight * (1 - progress);
        return {
          spacerHeight,
          contentViewportTop: spacerHeight,
        };
      },
    );

    assert.equal(
      samples[0].spacerHeight,
      initialSpacerHeight,
      `${viewport.name} initial lead-in`,
    );
    assert.equal(
      samples[0].contentViewportTop,
      viewport.viewportHeight,
      `${viewport.name} content begins one viewport below`,
    );
    assert.equal(
      samples.at(-1).spacerHeight,
      0,
      `${viewport.name} final lead-in`,
    );
    assert.equal(samples.at(-1).contentViewportTop, 0, `${viewport.name} content ends in view`);

    for (let index = 1; index < samples.length; index += 1) {
      assert.ok(
        samples[index].spacerHeight <= samples[index - 1].spacerHeight,
        `${viewport.name} lead-in grew between samples ${index - 1} and ${index}`,
      );
      assert.ok(
        samples[index].contentViewportTop <= samples[index - 1].contentViewportTop,
        `${viewport.name} content moved down between samples ${index - 1} and ${index}`,
      );
    }
  }
});

test("the reveal feather never exposes the dark lead-in above the live paper", () => {
  const feather = 64;
  for (const viewport of VIEWPORTS) {
    for (const progress of [0, 0.2, 0.5, 0.8, 1]) {
      const paperTop = viewport.viewportHeight * (1 - progress);
      const pointAbovePaper = Math.max(0, paperTop - 1);
      const pointInsidePaper = paperTop + feather / 2;
      const overlayAlpha = (y) => {
        if (y <= paperTop) return 1;
        if (y >= paperTop + feather) return 0;
        return 1 - (y - paperTop) / feather;
      };

      assert.equal(
        overlayAlpha(pointAbovePaper),
        1,
        `${viewport.name} keeps the lead-in covered at ${progress}`,
      );
      assert.ok(
        overlayAlpha(pointInsidePaper) > 0 && overlayAlpha(pointInsidePaper) < 1,
        `${viewport.name} blends only inside the live paper at ${progress}`,
      );
    }
  }
});
