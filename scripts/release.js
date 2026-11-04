#!/usr/bin/env node
// Release tooling for this plugin marketplace.
// Spec: docs/superpowers/specs/2026-11-03-release-script-design.md
//
//   node scripts/release.js <patch|minor|major|X.Y.Z> [--plugin <name>] [-m "<summary>"] [--dry-run]
//   node scripts/release.js publish [--dry-run]

// ---------- errors ----------

class ReleaseError extends Error {
  constructor(message, { next } = {}) {
    super(message);
    this.name = "ReleaseError";
    this.exitCode = 1;
    this.next = next;
  }
}

class CommandError extends Error {
  constructor(message, { next } = {}) {
    super(message);
    this.name = "CommandError";
    this.exitCode = 2;
    this.next = next;
  }
}

// ---------- version helpers ----------

const PLUGIN_RE = /^[a-z0-9][a-z0-9-]*$/;
const VERSION_BODY = "(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)";
const VERSION_RE = new RegExp(`^${VERSION_BODY}$`);

function parseVersion(v) {
  const m = VERSION_RE.exec(String(v));
  if (!m) throw new ReleaseError(`invalid version "${v}" (expected X.Y.Z)`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  }
  return 0;
}

function bumpVersion(current, kind) {
  const [major, minor, patch] = parseVersion(current);
  if (kind === "patch") return `${major}.${minor}.${patch + 1}`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  if (kind === "major") return `${major + 1}.0.0`;
  parseVersion(kind);
  return kind;
}

function setVersion(jsonText, version) {
  const re = /("version"\s*:\s*")[^"]*(")/;
  if (!re.test(jsonText)) throw new ReleaseError('plugin.json has no "version" field');
  return jsonText.replace(re, `$1${version}$2`);
}

function tagName(plugin, version) {
  return `${plugin}--v${version}`;
}

function latestTag(tags, plugin) {
  const re = new RegExp(`^${plugin}--v(${VERSION_BODY})$`);
  let best = null;
  for (const tag of tags) {
    const m = re.exec(tag);
    if (!m) continue;
    if (!best || compareVersions(m[1], best.version) > 0) best = { tag, version: m[1] };
  }
  return best;
}

// ---------- entry point ----------

async function main(argv) {}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {
  ReleaseError,
  CommandError,
  PLUGIN_RE,
  VERSION_RE,
  compareVersions,
  bumpVersion,
  setVersion,
  tagName,
  latestTag,
};
