#!/usr/bin/env node

import path from "node:path";

import sharp from "sharp";

const projectRoot = path.resolve(import.meta.dirname, "..");
const source = path.join(projectRoot, "public", "brand", "storyscrolls-social-master.png");
const destination = path.join(projectRoot, "public", "og.png");

await sharp(source)
  .resize(1200, 630, { fit: "cover", position: "centre" })
  .png({ compressionLevel: 9, quality: 94, effort: 10 })
  .toFile(destination);

const metadata = await sharp(destination).metadata();
if (metadata.width !== 1200 || metadata.height !== 630 || metadata.format !== "png") {
  throw new Error("The Story Scrolls social card was not rendered at 1200×630 PNG.");
}
