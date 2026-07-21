import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const scriptsDirectory = new URL("../scripts/", import.meta.url);

function candidates(url) {
  const result = spawnSync(
    "python3",
    [
      "-c",
      [
        "import json,sys",
        `sys.path.insert(0, ${JSON.stringify(decodeURIComponent(scriptsDirectory.pathname))})`,
        "from source_mirrors import source_download_candidates",
        `print(json.dumps(source_download_candidates(${JSON.stringify(url)})))`,
      ].join(";"),
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("curated builders map canonical source URLs to multiple approved mirrors", () => {
  const generated = candidates(
    "https://www.gutenberg.org/cache/epub/1342/pg1342-images.html",
  );
  assert.deepEqual(generated, [
    "https://gutenberg.pglaf.org/cache/epub/1342/pg1342-images.html",
    "https://mirror.cs.odu.edu/gutenberg-epub/1342/pg1342-images.html",
  ]);

  const collection = candidates("https://www.gutenberg.org/files/11/11-h/11-h.htm");
  assert.deepEqual(collection, [
    "https://gutenberg.pglaf.org/1/11/11-h/11-h.htm",
    "https://mirror.cs.odu.edu/gutenberg/1/11/11-h/11-h.htm",
    "https://mirror.csclub.uwaterloo.ca/gutenberg/1/11/11-h/11-h.htm",
  ]);

  for (const candidate of [...generated, ...collection]) {
    assert.doesNotMatch(candidate, /^https:\/\/(?:www\.)?gutenberg\.org\//);
  }
});

test("non-library sources pass through without a mirror rewrite", () => {
  const source = "https://upload.wikimedia.org/example/public-domain.jpg";
  assert.deepEqual(candidates(source), [source]);
});
