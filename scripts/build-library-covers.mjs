import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const projectRoot = path.resolve(import.meta.dirname, "..");
const publicRoot = path.join(projectRoot, "public");
const outputDirectory = path.join(publicRoot, "assets/library-covers");
const registry = JSON.parse(
  await readFile(path.join(projectRoot, "config/curated-books.json"), "utf8"),
);

const sources = [
  {
    slug: "alice-in-wonderland",
    source: "stories/alice-in-wonderland/images/alice02.webp",
  },
  {
    slug: "the-wonderful-wizard-of-oz",
    source: "stories/the-wonderful-wizard-of-oz/images/i009_edit.webp",
  },
  ...registry.map(({ slug }) => ({
    slug,
    source: `stories/${slug}/images/art-001.webp`,
  })),
];

await mkdir(outputDirectory, { recursive: true });
const assets = [];

for (const { slug, source } of sources) {
  const input = path.join(publicRoot, source);
  const file = `${slug}.webp`;
  const output = path.join(outputDirectory, file);
  const metadata = await sharp(input).metadata();
  if (metadata.format !== "webp" || !metadata.width || !metadata.height) {
    throw new Error(`Expected a valid WebP cover at ${input}.`);
  }
  await sharp(input)
    .resize({
      width: 640,
      height: 960,
      fit: "inside",
      withoutEnlargement: true,
      kernel: sharp.kernel.lanczos3,
    })
    .webp({ quality: 82, effort: 5, smartSubsample: true })
    .toFile(output);
  const outputMetadata = await sharp(output).metadata();
  const info = await stat(output);
  assets.push({
    slug,
    file,
    path: `/assets/library-covers/${file}`,
    source: `/${source}`,
    width: outputMetadata.width,
    height: outputMetadata.height,
    bytes: info.size,
  });
}

await writeFile(
  path.join(outputDirectory, "manifest.json"),
  `${JSON.stringify({ version: 1, count: assets.length, assets }, null, 2)}\n`,
  "utf8",
);

process.stdout.write(`Prepared ${assets.length} route-safe library covers.\n`);
