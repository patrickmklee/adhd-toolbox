// node --test scripts/release.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const R = require("./release.js");
const { ReleaseError } = R;

// ---------- Task 1: version helpers ----------

test("compareVersions is numeric per component", () => {
  assert.equal(R.compareVersions("0.10.0", "0.9.0"), 1);
  assert.equal(R.compareVersions("1.2.3", "1.2.3"), 0);
  assert.equal(R.compareVersions("1.0.0", "1.0.1"), -1);
});

test("bumpVersion", () => {
  assert.equal(R.bumpVersion("0.3.0", "patch"), "0.3.1");
  assert.equal(R.bumpVersion("0.3.4", "minor"), "0.4.0");
  assert.equal(R.bumpVersion("0.3.4", "major"), "1.0.0");
  assert.equal(R.bumpVersion("0.3.0", "1.2.3"), "1.2.3");
  for (const bad of ["v1.2.3", "1.2", "1.2.3-rc1", "01.2.3", ""])
    assert.throws(() => R.bumpVersion("0.3.0", bad), ReleaseError, bad);
  assert.throws(() => R.bumpVersion("garbage", "minor"), ReleaseError);
});

test("setVersion keeps formatting byte-for-byte", () => {
  const src = '{ "name": "adhd-kit", "version": "0.3.0", "description": "My personal toolkit", "author": { "name": "patrickmklee" } }';
  assert.equal(R.setVersion(src, "0.4.0"), src.replace('"0.3.0"', '"0.4.0"'));
  assert.equal(R.setVersion('{\n  "version": "1.0.0"\n}\n', "1.0.1"), '{\n  "version": "1.0.1"\n}\n');
  assert.throws(() => R.setVersion('{ "name": "x" }', "1.0.0"), ReleaseError);
});

test("tagName", () => {
  assert.equal(R.tagName("adhd-kit", "0.4.0"), "adhd-kit--v0.4.0");
});

test("latestTag picks highest version for this plugin only", () => {
  const tags = ["adhd-kit--v0.9.0", "adhd-kit--v0.10.0", "adhd-kit-extra--v9.0.0", "adhd-kit--v1.0.0-rc1", "adhd-kit-v2.0.0"];
  assert.deepEqual(R.latestTag(tags, "adhd-kit"), { tag: "adhd-kit--v0.10.0", version: "0.10.0" });
  assert.equal(R.latestTag([], "adhd-kit"), null);
});

// ---------- Task 2: args, notes, PR content ----------

test("parseArgs accepts the documented forms", () => {
  assert.deepEqual(R.parseArgs(["minor"]), { command: "bump", kind: "minor", dryRun: false });
  assert.deepEqual(R.parseArgs(["1.2.3", "--plugin=adhd-kit", "-m", "caveman", "--dry-run"]),
    { command: "bump", kind: "1.2.3", plugin: "adhd-kit", summary: "caveman", dryRun: true });
  assert.deepEqual(R.parseArgs(["patch", "--plugin", "adhd-kit", "--message=fix it"]),
    { command: "bump", kind: "patch", plugin: "adhd-kit", summary: "fix it", dryRun: false });
  assert.deepEqual(R.parseArgs(["publish", "--dry-run"]), { command: "publish", dryRun: true });
});

test("parseArgs rejects bad input, including flag-looking plugin names", () => {
  const bads = [[], ["mega"], ["minor", "--plugin", "--force"], ["minor", "--plugin=-x"],
    ["minor", "--plugin", "Bad_Name"], ["minor", "--plugin"], ["minor", "--nope"], ["minor", "patch"],
    ["minor", "-m"], ["minor", "-m", "--dry-run"], ["v1.2.3"]];
  for (const bad of bads) assert.throws(() => R.parseArgs(bad), ReleaseError, JSON.stringify(bad));
});

test("parseLog and formatNotes", () => {
  const commits = R.parseLog("a0e0f69 Add caveman skill\n6c45426 adhd-kit 0.3.0: release caveman skill\n\n");
  assert.deepEqual(commits, [
    { sha: "a0e0f69", subject: "Add caveman skill" },
    { sha: "6c45426", subject: "adhd-kit 0.3.0: release caveman skill" },
  ]);
  assert.equal(R.formatNotes(commits, "adhd-kit"), "- a0e0f69 Add caveman skill");
  assert.equal(R.formatNotes([], "adhd-kit"), "No changes under plugins/adhd-kit/.");
});

test("isBumpCommit", () => {
  assert.ok(R.isBumpCommit("adhd-kit 0.4.0", "adhd-kit"));
  assert.ok(R.isBumpCommit("adhd-kit 0.4.0: caveman", "adhd-kit", "0.4.0"));
  assert.ok(!R.isBumpCommit("adhd-kit 0.4.0", "adhd-kit", "0.5.0"));
  assert.ok(!R.isBumpCommit("adhd-kit-extra 1.0.0", "adhd-kit"));
  assert.ok(!R.isBumpCommit("adhd-kit 0.4.0 tweaks", "adhd-kit"));
});

test("bumpedPlugins overlays the dry-run target", () => {
  const main = { "adhd-kit": "0.3.0", other: "1.0.0" };
  assert.deepEqual(R.bumpedPlugins(main, { ...main }, { plugin: "adhd-kit", version: "0.4.0" }),
    [{ plugin: "adhd-kit", version: "0.4.0" }]);
  assert.deepEqual(R.bumpedPlugins(main, { "adhd-kit": "0.4.0", other: "1.1.0", fresh: "0.1.0" }).map((b) => b.plugin),
    ["adhd-kit", "fresh", "other"]);
});

test("prTitle and prBody", () => {
  assert.equal(R.prTitle([{ plugin: "adhd-kit", version: "0.4.0" }, { plugin: "other", version: "1.2.0" }]),
    "adhd-kit 0.4.0, other 1.2.0");
  assert.equal(R.prBody([{ plugin: "adhd-kit", version: "0.4.0", notes: "- a1 x" }]), "## adhd-kit 0.4.0\n\n- a1 x");
  assert.equal(R.prBody([{ plugin: "a", version: "1.0.0", notes: "n1" }, { plugin: "b", version: "2.0.0", notes: "n2" }]),
    "## a 1.0.0\n\nn1\n\n## b 2.0.0\n\nn2");
});
