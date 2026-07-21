#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, readFile, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(
  projectRoot,
  "deployment",
  "com.corydev.thestoryscrolls-illuminated-catalog.plist",
);
const targetDirectory = path.join(os.homedir(), "Library", "LaunchAgents");
const target = path.join(targetDirectory, path.basename(source));
const label = "com.corydev.thestoryscrolls-illuminated-catalog";
const domain = `gui/${process.getuid()}`;
const install = process.argv.includes("--install");

function run(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`.trim());
  }
  return result;
}

const plist = await readFile(source, "utf8");
for (const expected of [
  `<string>${label}</string>`,
  "<key>StartCalendarInterval</key>",
  "<integer>3</integer>",
  "<integer>45</integer>",
  "scripts/sync-illuminated-catalog.mjs",
  "_data/thestoryscrolls/illuminated-catalog",
]) {
  if (!plist.includes(expected)) throw new Error(`Catalog LaunchAgent is missing ${expected}.`);
}
run("plutil", ["-lint", source]);

if (!install) {
  process.stdout.write(`Catalog LaunchAgent is valid. Install target: ${target}\n`);
  process.stdout.write("Run again with --install to copy, bootstrap, and start it.\n");
  process.exit(0);
}

await mkdir(targetDirectory, { recursive: true, mode: 0o755 });
const temporaryTarget = `${target}.${process.pid}.tmp`;
await rm(temporaryTarget, { force: true });
await copyFile(source, temporaryTarget);
await chmod(temporaryTarget, 0o644);
await rename(temporaryTarget, target);
run("launchctl", ["bootout", domain, target], { allowFailure: true });
run("launchctl", ["bootstrap", domain, target]);
run("launchctl", ["kickstart", "-k", `${domain}/${label}`]);
process.stdout.write(`Installed and started ${label}.\n`);
