import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import Database from "better-sqlite3";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, "..");

test("community backup captures all mutable state and excludes private/transient state", async (t) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "storyscrolls-backup-"));
  t.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));

  const dataRoot = path.join(temporaryRoot, "data");
  const backupRoot = path.join(temporaryRoot, "backups");
  await fs.mkdir(dataRoot, { recursive: true });

  const database = new Database(path.join(dataRoot, "storyscrolls.sqlite3"));
  database.exec("CREATE TABLE proof (value TEXT NOT NULL); INSERT INTO proof VALUES ('preserved')");
  database.close();

  const included = ["media", "character-references", ".source-cache", ".orphaned-media"];
  for (const directory of included) {
    await fs.mkdir(path.join(dataRoot, directory), { recursive: true });
    await fs.writeFile(path.join(dataRoot, directory, "proof.txt"), `${directory}\n`);
  }
  await fs.writeFile(path.join(dataRoot, ".safety-pepper"), "test-only-pepper\n");
  for (const directory of [".staging", "illuminated-catalog"]) {
    await fs.mkdir(path.join(dataRoot, directory), { recursive: true });
    await fs.writeFile(path.join(dataRoot, directory, "must-not-copy.txt"), "private or transient\n");
  }

  const { stdout } = await execFileAsync(
    process.execPath,
    [path.join(projectRoot, "scripts", "backup-community.mjs")],
    { env: { ...process.env, STORYSCROLLS_DATA_DIR: dataRoot, STORYSCROLLS_BACKUP_DIR: backupRoot } },
  );
  const destination = stdout.trim();
  const manifest = JSON.parse(await fs.readFile(path.join(destination, "manifest.json"), "utf8"));
  const manifestPaths = new Set(manifest.files.map((file) => file.path));

  assert.equal(manifest.source, dataRoot);
  assert.ok(manifestPaths.has("storyscrolls.sqlite3"));
  assert.ok(manifestPaths.has(".safety-pepper"));
  for (const directory of included) {
    assert.ok(manifestPaths.has(path.join(directory, "proof.txt")), `${directory} is in the manifest`);
  }
  assert.equal(manifest.files.some((file) => file.path.startsWith(".staging/")), false);
  assert.equal(manifest.files.some((file) => file.path.startsWith("illuminated-catalog/")), false);

  const verified = new Database(path.join(destination, "storyscrolls.sqlite3"), {
    readonly: true,
    fileMustExist: true,
  });
  assert.equal(verified.pragma("integrity_check", { simple: true }), "ok");
  assert.equal(verified.prepare("SELECT value FROM proof").pluck().get(), "preserved");
  verified.close();
});
