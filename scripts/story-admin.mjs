#!/usr/bin/env node

import { createPlatformServer } from "../server/platform-server.mjs";

const [command, slug] = process.argv.slice(2);
const statusByCommand = new Map([
  ["approve", "approved"],
  ["review", "review"],
  ["reject", "rejected"],
  ["remove", "removed"],
]);

if (!statusByCommand.has(command) || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug ?? "")) {
  process.stderr.write("Usage: node scripts/story-admin.mjs <approve|review|reject|remove> <story-slug>\n");
  process.exitCode = 2;
} else {
  const platform = createPlatformServer();
  try {
    const changed = platform.setListingStatus(slug, statusByCommand.get(command));
    if (!changed) {
      process.stderr.write("No story was changed. Approval also requires that the creator requested public listing.\n");
      process.exitCode = 1;
    } else {
      process.stdout.write(`${slug}: ${statusByCommand.get(command)}\n`);
    }
  } finally {
    await platform.close();
  }
}
