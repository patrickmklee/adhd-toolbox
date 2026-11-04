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
