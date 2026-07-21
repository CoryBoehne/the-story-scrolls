import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDirectory = path.join(projectRoot, "public");
const iconSvg = await readFile(path.join(publicDirectory, "favicon.svg"));

async function renderIcon(size) {
  return sharp(iconSvg, { density: 512 })
    .resize(size, size, { fit: "fill" })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function makeIco(entries) {
  const directorySize = 6 + entries.length * 16;
  const header = Buffer.alloc(directorySize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  let offset = directorySize;
  entries.forEach(({ size, data }, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size === 256 ? 0 : size, entry);
    header.writeUInt8(size === 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });

  return Buffer.concat([header, ...entries.map(({ data }) => data)]);
}

const faviconSizes = [16, 32, 48];
const faviconEntries = await Promise.all(
  faviconSizes.map(async (size) => ({ size, data: await renderIcon(size) })),
);

await Promise.all([
  writeFile(path.join(publicDirectory, "favicon.ico"), makeIco(faviconEntries)),
  writeFile(path.join(publicDirectory, "favicon-32x32.png"), faviconEntries[1].data),
  writeFile(path.join(publicDirectory, "apple-touch-icon.png"), await renderIcon(180)),
  writeFile(path.join(publicDirectory, "icon-192.png"), await renderIcon(192)),
  writeFile(path.join(publicDirectory, "icon-512.png"), await renderIcon(512)),
]);

const maskableMark = await renderIcon(360);
await sharp({
  create: {
    width: 512,
    height: 512,
    channels: 4,
    background: "#070c13",
  },
})
  .composite([{ input: maskableMark, left: 76, top: 76 }])
  .png({ compressionLevel: 9 })
  .toFile(path.join(publicDirectory, "icon-maskable-512.png"));

const socialSource = process.argv[2];
if (socialSource) {
  const resolvedSource = path.resolve(socialSource);
  await stat(resolvedSource);
  await sharp(resolvedSource)
    .resize(1140, 630, { fit: "cover", position: "center" })
    .extend({
      top: 0,
      bottom: 0,
      left: 30,
      right: 30,
      background: "#06101b",
    })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toFile(path.join(publicDirectory, "og.png"));
}
