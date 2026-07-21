import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const projectRoot = path.resolve(import.meta.dirname, "..");
const sourceDirectory = process.env.SCROLL_ENTRY_SEQUENCE_SOURCE
  ?? "/Users/coryboehne/Desktop/AntiGravity/Temp/into the scroll-TIFF Image Sequence";
const outputDirectory = path.join(projectRoot, "public/assets/scroll-entry");
const endlessParchmentPath = path.join(projectRoot, "public/assets/endless-parchment-scroll.webp");

const source = {
  count: 180,
  fps: 30,
  effectiveFps: 24,
  width: 2160,
  height: 3840,
};

const quality = 80;
const concurrency = 3;
const variants = [
  { id: "960w", width: 960, height: 1707, directory: "frames-960" },
  { id: "1440w", width: 1440, height: 2560, directory: "frames-1440" },
];

// This source was exported at 30 fps from a 24 fps timeline. Every fifth
// source interval therefore contains one exact adjacent duplicate.
const expectedDuplicateSourceIndexes = Array.from(
  { length: 36 },
  (_, index) => 1 + (index * 5),
);
const duplicateSourceIndexes = new Set(expectedDuplicateSourceIndexes);

const phaseSources = {
  bookHold: { start: 0, end: 15 },
  pageTurn: { start: 17, end: 94 },
  scrollReveal: { start: 95, end: 167 },
  parchmentHandoff: { start: 168, end: 179 },
};

const markerSources = {
  sequenceStart: 0,
  pageLiftStart: 17,
  illustratedFlipStart: 27,
  scrollPlateRevealed: 95,
  scrollZoomStart: 97,
  cleanParchmentStart: 168,
  sequenceEnd: 179,
};

// Frame 179 and the existing endless parchment share the same centered
// geometry at this scale. The crop and transition-only grade make a useful
// intermediate texture while the live repeating background settles to 1x.
const bridge = {
  parchmentScale: 1.2,
  sourceYOffsetRatio: 1640 / source.height,
  quality,
  grade: {
    slope: [0.694351, 0.636229, 0.553502],
    intercept: [66.475477, 70.166155, 68.045665],
  },
};

function sourceName(index) {
  return `frame-${String(index).padStart(6, "0")}.tiff`;
}

function outputName(index) {
  return `frame-${String(index).padStart(3, "0")}.webp`;
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function outputIndexForSource(sourceFrameIndexes, sourceIndex) {
  const outputIndex = sourceFrameIndexes.indexOf(sourceIndex);
  if (outputIndex < 0) {
    throw new Error(`Phase source frame ${sourceIndex} is an excluded cadence duplicate.`);
  }
  return outputIndex;
}

const sourceFiles = (await readdir(sourceDirectory))
  .filter((file) => /^frame-\d{6}\.tiff$/i.test(file))
  .sort();

if (sourceFiles.length !== source.count) {
  throw new Error(`Expected ${source.count} source frames, found ${sourceFiles.length} in ${sourceDirectory}.`);
}

for (let index = 0; index < source.count; index += 1) {
  const expected = sourceName(index);
  if (sourceFiles[index] !== expected) {
    throw new Error(`Missing or out-of-order sequence frame ${expected}.`);
  }

  const metadata = await sharp(path.join(sourceDirectory, expected), {
    limitInputPixels: false,
  }).metadata();
  if (
    metadata.format !== "tiff"
    || metadata.width !== source.width
    || metadata.height !== source.height
    || metadata.bitsPerSample !== 16
    || metadata.channels !== 4
  ) {
    throw new Error(
      `${expected} is ${metadata.format ?? "unknown"} ${metadata.width ?? "?"}x${metadata.height ?? "?"}, `
      + `${metadata.bitsPerSample ?? "?"}-bit/${metadata.channels ?? "?"}-channel; expected `
      + `16-bit RGBA TIFF ${source.width}x${source.height}.`,
    );
  }
}
process.stdout.write(
  `Validated ${source.count} contiguous 16-bit RGBA TIFF frames at ${source.width}x${source.height}.\n`,
);

const sourceHashes = [];
for (let index = 0; index < sourceFiles.length; index += 1) {
  sourceHashes.push(await hashFile(path.join(sourceDirectory, sourceFiles[index])));
  if ((index + 1) % 18 === 0 || index + 1 === sourceFiles.length) {
    process.stdout.write(`Hashed ${index + 1}/${sourceFiles.length} source frames.\n`);
  }
}

const actualDuplicateSourceIndexes = sourceHashes
  .map((hash, index) => (index > 0 && hash === sourceHashes[index - 1] ? index : null))
  .filter((index) => index !== null);

if (
  actualDuplicateSourceIndexes.length !== expectedDuplicateSourceIndexes.length
  || actualDuplicateSourceIndexes.some(
    (index, position) => index !== expectedDuplicateSourceIndexes[position],
  )
) {
  throw new Error(
    `Unexpected adjacent duplicate cadence. Expected ${expectedDuplicateSourceIndexes.join(",")}; `
    + `found ${actualDuplicateSourceIndexes.join(",")}.`,
  );
}
process.stdout.write(
  `Validated and removed ${actualDuplicateSourceIndexes.length} exact 24-to-30 fps cadence duplicates.\n`,
);

const sourceFrameIndexes = sourceFiles
  .map((_, index) => index)
  .filter((index) => !duplicateSourceIndexes.has(index));

if (sourceFrameIndexes.length !== 144) {
  throw new Error(`Expected 144 unique frames, found ${sourceFrameIndexes.length}.`);
}

const phases = Object.fromEntries(
  Object.entries(phaseSources).map(([id, phase]) => [
    id,
    {
      startIndex: outputIndexForSource(sourceFrameIndexes, phase.start),
      endIndex: outputIndexForSource(sourceFrameIndexes, phase.end),
      sourceStartIndex: phase.start,
      sourceEndIndex: phase.end,
    },
  ]),
);
const markers = Object.fromEntries(
  Object.entries(markerSources).map(([id, sourceIndex]) => [
    id,
    {
      index: outputIndexForSource(sourceFrameIndexes, sourceIndex),
      sourceIndex,
    },
  ]),
);

await rm(outputDirectory, { recursive: true, force: true });
await Promise.all(variants.map((variant) => (
  mkdir(path.join(outputDirectory, variant.directory), { recursive: true })
)));

let nextOutputIndex = 0;
let completed = 0;

async function worker() {
  while (nextOutputIndex < sourceFrameIndexes.length) {
    const outputIndex = nextOutputIndex;
    nextOutputIndex += 1;
    const sourceIndex = sourceFrameIndexes[outputIndex];
    const sourcePath = path.join(sourceDirectory, sourceName(sourceIndex));

    await Promise.all(variants.map((variant) => (
      sharp(sourcePath, { limitInputPixels: false })
        .removeAlpha()
        .resize(variant.width, variant.height, {
          fit: "fill",
          kernel: sharp.kernel.lanczos3,
        })
        .webp({ quality, effort: 4, smartSubsample: true })
        .toFile(path.join(outputDirectory, variant.directory, outputName(outputIndex)))
    )));

    completed += 1;
    if (completed % 12 === 0 || completed === sourceFrameIndexes.length) {
      process.stdout.write(`Converted ${completed}/${sourceFrameIndexes.length} unique frames in both variants.\n`);
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));

const manifestVariants = [];
for (const variant of variants) {
  const variantDirectory = path.join(outputDirectory, variant.directory);
  const files = (await readdir(variantDirectory))
    .filter((file) => /^frame-\d{3}\.webp$/i.test(file))
    .sort();
  if (files.length !== sourceFrameIndexes.length) {
    throw new Error(`Expected ${sourceFrameIndexes.length} ${variant.id} frames, found ${files.length}.`);
  }

  let bytes = 0;
  for (let index = 0; index < files.length; index += 1) {
    const expected = outputName(index);
    if (files[index] !== expected) throw new Error(`Missing ${variant.id} output ${expected}.`);

    const filePath = path.join(variantDirectory, expected);
    const [metadata, fileStat] = await Promise.all([
      sharp(filePath).metadata(),
      stat(filePath),
    ]);
    if (
      metadata.format !== "webp"
      || metadata.width !== variant.width
      || metadata.height !== variant.height
    ) {
      throw new Error(
        `${variant.id}/${expected} is ${metadata.format ?? "unknown"} `
        + `${metadata.width ?? "?"}x${metadata.height ?? "?"}; expected WebP `
        + `${variant.width}x${variant.height}.`,
      );
    }
    bytes += fileStat.size;
  }

  manifestVariants.push({
    id: variant.id,
    width: variant.width,
    height: variant.height,
    quality,
    basePath: `/assets/scroll-entry/${variant.directory}`,
    filePattern: "frame-{index:000}.webp",
    bytes,
  });
  process.stdout.write(
    `Validated ${variant.id}: ${files.length} frames, ${bytes.toLocaleString("en-US")} bytes.\n`,
  );
}

const bridgeVariants = [];
for (const variant of variants) {
  const scaledWidth = Math.round(variant.width * bridge.parchmentScale);
  const scaledHeight = Math.round((8688 / 2172) * scaledWidth);
  const left = Math.round((scaledWidth - variant.width) / 2);
  const top = Math.round(variant.height * bridge.sourceYOffsetRatio);
  const fileName = `bridge-${variant.width}.webp`;
  const filePath = path.join(outputDirectory, fileName);

  await sharp(endlessParchmentPath, { limitInputPixels: false })
    .removeAlpha()
    .resize(scaledWidth, scaledHeight, {
      fit: "fill",
      kernel: sharp.kernel.lanczos3,
    })
    .extract({ left, top, width: variant.width, height: variant.height })
    .linear(bridge.grade.slope, bridge.grade.intercept)
    .webp({ quality: bridge.quality, effort: 4, smartSubsample: true })
    .toFile(filePath);

  const [metadata, fileStat] = await Promise.all([
    sharp(filePath).metadata(),
    stat(filePath),
  ]);
  if (
    metadata.format !== "webp"
    || metadata.width !== variant.width
    || metadata.height !== variant.height
  ) {
    throw new Error(
      `${fileName} is ${metadata.format ?? "unknown"} `
      + `${metadata.width ?? "?"}x${metadata.height ?? "?"}; expected WebP `
      + `${variant.width}x${variant.height}.`,
    );
  }

  bridgeVariants.push({
    id: variant.id,
    width: variant.width,
    height: variant.height,
    url: `/assets/scroll-entry/${fileName}`,
    bytes: fileStat.size,
  });
  process.stdout.write(`Created ${fileName}: ${fileStat.size.toLocaleString("en-US")} bytes.\n`);
}

const manifest = {
  version: 1,
  source: {
    ...source,
    duplicateSourceIndexes: actualDuplicateSourceIndexes,
  },
  frames: {
    count: sourceFrameIndexes.length,
    filePattern: "frame-{index:000}.webp",
    sourceFrameIndexes,
    phases,
    markers,
  },
  variants: manifestVariants,
  handoff: {
    startIndex: phases.parchmentHandoff.startIndex,
    endIndex: phases.parchmentHandoff.endIndex,
    parchmentScale: bridge.parchmentScale,
    sequenceExposure: {
      start: 0.892,
      end: 0.936,
    },
    bridgeSourceYOffsetRatio: bridge.sourceYOffsetRatio,
    bridgeGrade: bridge.grade,
    bridgeVariants,
  },
};

await writeFile(
  path.join(outputDirectory, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);
process.stdout.write(`Wrote ${path.join(outputDirectory, "manifest.json")}\n`);
