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

// ---------- Task 3: planning ----------

const { CommandError } = R;

function bumpState(overrides = {}) {
  return {
    plugin: "adhd-kit", kind: "minor", summary: undefined, dryRun: false,
    branch: "develop", clean: true, ahead: 0, behind: 0, headSubject: "Merge pull request #3 from patrickmklee/develop",
    mainVersion: "0.3.0", developVersion: "0.3.0", tags: ["adhd-kit--v0.3.0"],
    marketplaceHasVersion: false, hasGitleaks: true,
    ...overrides,
  };
}

test("planBump refuses unsafe state", () => {
  const cases = [
    [{ branch: "main" }, /develop/],
    [{ clean: false }, /clean/],
    [{ behind: 1 }, /git pull/],
    [{ ahead: 2 }, /ahead/],
    [{ marketplaceHasVersion: true }, /marketplace\.json/],
    [{ hasGitleaks: false }, /winget install gitleaks/],
    [{ kind: "0.3.0" }, /0\.3\.0/],
    [{ kind: "0.2.0", tags: [] }, /0\.2\.0/],
    [{ tags: ["adhd-kit--v0.3.0", "adhd-kit--v0.4.0"] }, /adhd-kit--v0\.4\.0/],
    [{ developVersion: "0.5.0" }, /explicit version/],
    [{ ahead: 1, headSubject: "fix typo" }, /fix typo/],
  ];
  for (const [o, msg] of cases) assert.throws(() => R.planBump(bumpState(o)), (e) => e instanceof ReleaseError && msg.test(`${e.message} ${e.next || ""}`), JSON.stringify(o));
});

test("planBump fresh run writes, commits and pushes", () => {
  assert.deepEqual(R.planBump(bumpState()), {
    target: "0.4.0", tag: "adhd-kit--v0.4.0", commitMessage: "adhd-kit 0.4.0",
    write: true, commit: true, push: true, warnings: [],
  });
  assert.equal(R.planBump(bumpState({ summary: "caveman" })).commitMessage, "adhd-kit 0.4.0: caveman");
});

test("planBump resumes after a failed push, even without the same -m", () => {
  const p = R.planBump(bumpState({ ahead: 1, headSubject: "adhd-kit 0.4.0: caveman", developVersion: "0.4.0" }));
  assert.deepEqual([p.target, p.write, p.commit, p.push], ["0.4.0", false, false, true]);
});

test("planBump rerun after push keeps the same target and changes nothing", () => {
  const p = R.planBump(bumpState({ developVersion: "0.4.0" }));
  assert.deepEqual([p.target, p.write, p.commit, p.push], ["0.4.0", false, false, false]);
});

test("planBump dry-run without gitleaks only warns", () => {
  const p = R.planBump(bumpState({ hasGitleaks: false, dryRun: true }));
  assert.equal(p.warnings.length, 1);
});

test("releaseExists only treats 'release not found' as missing", () => {
  assert.equal(R.releaseExists({ status: 0, stderr: "" }), true);
  assert.equal(R.releaseExists({ status: 1, stderr: "release not found\n" }), false);
  assert.throws(() => R.releaseExists({ status: 1, stderr: "HTTP 401: Bad credentials" }), CommandError);
});

test("planPublish", () => {
  const base = { plugin: "adhd-kit", tags: ["adhd-kit--v0.3.0"], hasGitleaks: true, dryRun: false };
  const missing = { status: 1, stderr: "release not found" };
  assert.deepEqual(R.planPublish({ ...base, version: "0.4.0", view: missing }),
    { action: "create", tag: "adhd-kit--v0.4.0", since: "adhd-kit--v0.3.0", warnings: [] });
  assert.deepEqual(R.planPublish({ ...base, version: "0.3.0", view: { status: 0, stderr: "" } }),
    { action: "skip", tag: "adhd-kit--v0.3.0" });
  assert.deepEqual(R.planPublish({ ...base, version: "0.3.0", view: missing }),
    { action: "create", tag: "adhd-kit--v0.3.0", since: null, warnings: [] });
  assert.throws(() => R.planPublish({ ...base, version: "0.2.0", view: missing }), /went backwards/);
  assert.throws(() => R.planPublish({ ...base, version: "0.4.0", view: missing, hasGitleaks: false }), ReleaseError);
  assert.equal(R.planPublish({ ...base, version: "0.4.0", view: missing, hasGitleaks: false, dryRun: true }).warnings.length, 1);
});
