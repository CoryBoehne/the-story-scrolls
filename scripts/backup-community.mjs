#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import Database from "better-sqlite3";

const projectRoot = path.resolve(import.meta.dirname, "..");
const hostingRoot = path.resolve(projectRoot, "..", "..");
const dataRoot = path.resolve(
  process.env.STORYSCROLLS_DATA_DIR || path.join(hostingRoot, "_data", "thestoryscrolls"),
);
const backupRoot = path.resolve(
  process.env.STORYSCROLLS_BACKUP_DIR
    || path.join(hostingRoot, "_backups", "private", "thestoryscrolls"),
);
const databasePath = path.join(dataRoot, "storyscrolls.sqlite3");

if (!fs.existsSync(databasePath)) {
  throw new Error(`The Story Scrolls database not found: ${databasePath}`);
}

const timestamp = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
const destination = path.join(backupRoot, timestamp);
await fsp.mkdir(destination, { recursive: true, mode: 0o750 });

const source = new Database(databasePath, { readonly: true, fileMustExist: true });
const databaseBackup = path.join(destination, "storyscrolls.sqlite3");
try {
  await source.backup(databaseBackup);
} finally {
  source.close();
}

const verified = new Database(databaseBackup, { readonly: true, fileMustExist: true });
try {
  const result = verified.pragma("integrity_check", { simple: true });
  if (result !== "ok") throw new Error(`SQLite integrity check failed: ${result}`);
} finally {
  verified.close();
}
await Promise.all([
  fsp.rm(`${databaseBackup}-wal`, { force: true }),
  fsp.rm(`${databaseBackup}-shm`, { force: true }),
]);

const mediaSource = path.join(dataRoot, "media");
if (fs.existsSync(mediaSource)) {
  await fsp.cp(mediaSource, path.join(destination, "media"), {
    recursive: true,
    preserveTimestamps: true,
    errorOnExist: true,
  });
}
const pepperSource = path.join(dataRoot, ".safety-pepper");
if (fs.existsSync(pepperSource)) {
  const pepperDestination = path.join(destination, ".safety-pepper");
  await fsp.copyFile(pepperSource, pepperDestination, fs.constants.COPYFILE_EXCL);
  await fsp.chmod(pepperDestination, 0o600);
}

async function inventory(directory, prefix = "") {
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === "manifest.json") continue;
    const relative = path.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await inventory(absolute, relative));
    if (entry.isFile()) {
      const bytes = await fsp.readFile(absolute);
      files.push({
        path: relative,
        bytes: bytes.length,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      });
    }
  }
  return files;
}

const files = await inventory(destination);
await fsp.writeFile(
  path.join(destination, "manifest.json"),
  `${JSON.stringify({ createdAt: new Date().toISOString(), source: dataRoot, files }, null, 2)}\n`,
  { mode: 0o640, flag: "wx" },
);
process.stdout.write(`${destination}\n`);
