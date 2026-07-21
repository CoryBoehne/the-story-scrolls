import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const projectRoot = path.resolve(import.meta.dirname, "..");
const sourceDirectory = process.env.LIBRARY_INTRO_SEQUENCE_SOURCE
  ?? "/Users/coryboehne/Desktop/AntiGravity/Temp/Scrolly For The Story Scrolls/Main Scrolly Intro-TIFF Image Sequence";
const outputDirectory = path.join(projectRoot, "public/assets/library-intro");

const source = {
  count: 316,
  fps: 30,
  splitFrame: 231,
  width: 2160,
  height: 3840,
};

const quality = 80;
const concurrency = 3;
const variants = [
  { id: "960w", width: 960, height: 1707, directory: "frames-960" },
  { id: "1440w", width: 1440, height: 2560, directory: "frames-1440" },
];

const expectedDuplicateSourceIndexes = [
  ...Array.from({ length: 36 }, (_, index) => 53 + (index * 5)),
  ...Array.from({ length: 17 }, (_, index) => 232 + (index * 5)),
];
const duplicateSourceIndexes = new Set(expectedDuplicateSourceIndexes);

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

const sourceFiles = (await readdir(sourceDirectory))
  .filter((file) => /^frame-\d{6}\.tiff$/i.test(file))
  .sort();

if (sourceFiles.length !== source.count) {
  throw new Error(`Expected ${source.count} source frames, found ${sourceFiles.length} in ${sourceDirectory}.`);
}

for (let index = 0; index < source.count; index += 1) {
  const expected = `frame-${String(index).padStart(6, "0")}.tiff`;
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
  ) {
    throw new Error(
      `${expected} is ${metadata.format ?? "unknown"} ${metadata.width ?? "?"}x${metadata.height ?? "?"}; expected TIFF ${source.width}x${source.height}.`,
    );
  }
}
process.stdout.write(`Validated ${source.count} contiguous ${source.width}x${source.height} TIFF source frames.\n`);

const sourceHashes = [];
for (let index = 0; index < sourceFiles.length; index += 1) {
  sourceHashes.push(await hashFile(path.join(sourceDirectory, sourceFiles[index])));
  if ((index + 1) % 32 === 0 || index + 1 === sourceFiles.length) {
    process.stdout.write(`Hashed ${index + 1}/${sourceFiles.length} source frames.\n`);
  }
}

const actualDuplicateSourceIndexes = sourceHashes
  .map((hash, index) => (index > 0 && hash === sourceHashes[index - 1] ? index : null))
  .filter((index) => index !== null);

if (
  actualDuplicateSourceIndexes.length !== expectedDuplicateSourceIndexes.length
  || actualDuplicateSourceIndexes.some((index, position) => index !== expectedDuplicateSourceIndexes[position])
) {
  throw new Error(
    `Unexpected adjacent duplicate cadence. Expected ${expectedDuplicateSourceIndexes.join(",")}; found ${actualDuplicateSourceIndexes.join(",")}.`,
  );
}
process.stdout.write(`Validated ${actualDuplicateSourceIndexes.length} exact adjacent cadence duplicates.\n`);

const sourceFrameIndexes = sourceFiles
  .map((_, index) => index)
  .filter((index) => !duplicateSourceIndexes.has(index));
const splitOutputIndex = sourceFrameIndexes.indexOf(source.splitFrame);

if (sourceFrameIndexes.length !== 263 || splitOutputIndex !== 195) {
  throw new Error(
    `Expected 263 output frames with source frame ${source.splitFrame} at output index 195; found ${sourceFrameIndexes.length} and ${splitOutputIndex}.`,
  );
}

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
    const sourcePath = path.join(sourceDirectory, sourceFiles[sourceIndex]);

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
    if (completed % 16 === 0 || completed === sourceFrameIndexes.length) {
      process.stdout.write(`Converted ${completed}/${sourceFrameIndexes.length} unique frames in both variants.\n`);
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));

const manifestVariants = [];
for (const variant of variants) {
  const variantDirectory = path.join(outputDirectory, variant.directory);
  const files = (await readdir(variantDirectory)).filter((file) => /^frame-\d{3}\.webp$/i.test(file)).sort();
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
        `${variant.id}/${expected} is ${metadata.format ?? "unknown"} ${metadata.width ?? "?"}x${metadata.height ?? "?"}; expected WebP ${variant.width}x${variant.height}.`,
      );
    }
    bytes += fileStat.size;
  }

  manifestVariants.push({
    id: variant.id,
    width: variant.width,
    height: variant.height,
    quality,
    basePath: `/assets/library-intro/${variant.directory}`,
    filePattern: "frame-{index:000}.webp",
    bytes,
  });
  process.stdout.write(`Validated ${variant.id}: ${files.length} frames, ${bytes.toLocaleString("en-US")} bytes.\n`);
}

const manifest = {
  version: 1,
  source: {
    count: source.count,
    fps: source.fps,
    splitFrame: source.splitFrame,
  },
  frames: {
    count: sourceFrameIndexes.length,
    openingEndIndex: splitOutputIndex,
    turnStartIndex: splitOutputIndex,
    turnCount: sourceFrameIndexes.length - splitOutputIndex,
    sourceFrameIndexes,
  },
  variants: manifestVariants,
};

await writeFile(
  path.join(outputDirectory, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);
process.stdout.write(`Wrote ${path.join(outputDirectory, "manifest.json")}\n`);
