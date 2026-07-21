import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import test from "node:test";

const plistUrl = new URL(
  "../deployment/com.corydev.thestoryscrolls-illuminated-catalog.plist",
  import.meta.url,
);

test("illuminated catalog refresh is a valid daily private-cache LaunchAgent", async () => {
  const [plist, packageJson] = await Promise.all([
    readFile(plistUrl, "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  execFileSync("plutil", ["-lint", fileURLToPath(plistUrl)]);
  assert.match(plist, /<key>StartCalendarInterval<\/key>[\s\S]*<key>Hour<\/key>\s*<integer>3<\/integer>[\s\S]*<key>Minute<\/key>\s*<integer>45<\/integer>/);
  assert.match(plist, /_data\/thestoryscrolls\/illuminated-catalog/);
  assert.doesNotMatch(plist, /public\/|dist\/client/);
  assert.equal(packageJson.scripts["illuminated:sync"], "node scripts/sync-illuminated-catalog.mjs");
  assert.equal(
    packageJson.scripts["illuminated:agent:check"],
    "node scripts/install-illuminated-catalog-agent.mjs",
  );
  assert.equal(
    packageJson.scripts["illuminated:agent:install"],
    "node scripts/install-illuminated-catalog-agent.mjs --install",
  );
});
