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

// ---------- arguments ----------

const KINDS = new Set(["patch", "minor", "major"]);
const USAGE = [
  "usage: node scripts/release.js <patch|minor|major|X.Y.Z> [--plugin <name>] [-m <summary>] [--dry-run]",
  "       node scripts/release.js publish [--dry-run]",
].join("\n");

function usageError(why) {
  return new ReleaseError(`${why}\n${USAGE}`);
}

function parseArgs(argv) {
  let positional = null;
  let plugin;
  let summary;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    let flag = arg;
    let value;
    const eq = arg.indexOf("=");
    if (arg.startsWith("--") && eq > 0) {
      flag = arg.slice(0, eq);
      value = arg.slice(eq + 1);
    }

    if (flag === "--dry-run") {
      if (value !== undefined) throw usageError("--dry-run takes no value");
      dryRun = true;
    } else if (flag === "--plugin" || flag === "-m" || flag === "--message") {
      if (value === undefined) value = argv[++i];
      if (value === undefined || value === "" || value.startsWith("-")) {
        throw usageError(`${flag} needs a value`);
      }
      if (flag === "--plugin") {
        if (!PLUGIN_RE.test(value)) throw usageError(`invalid plugin name "${value}"`);
        plugin = value;
      } else {
        summary = value;
      }
    } else if (arg.startsWith("-")) {
      throw usageError(`unknown option ${arg}`);
    } else if (positional !== null) {
      throw usageError(`unexpected argument ${arg}`);
    } else {
      positional = arg;
    }
  }

  if (positional === null) throw usageError("missing command");
  if (positional === "publish") {
    if (plugin !== undefined || summary !== undefined) throw usageError("publish takes only --dry-run");
    return { command: "publish", dryRun };
  }
  if (!KINDS.has(positional) && !VERSION_RE.test(positional)) {
    throw usageError(`unknown command "${positional}"`);
  }
  const out = { command: "bump", kind: positional, dryRun };
  if (plugin !== undefined) out.plugin = plugin;
  if (summary !== undefined) out.summary = summary;
  return out;
}

// ---------- notes and PR content ----------

function parseLog(text) {
  const commits = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const sp = line.indexOf(" ");
    commits.push(sp < 0 ? { sha: line, subject: "" } : { sha: line.slice(0, sp), subject: line.slice(sp + 1) });
  }
  return commits;
}

function isBumpCommit(subject, plugin, version) {
  const v = version ? version.replace(/\./g, "\\.") : "\\d+\\.\\d+\\.\\d+";
  return new RegExp(`^${plugin} ${v}(: .*)?$`).test(subject);
}

function formatNotes(commits, plugin) {
  const lines = commits.filter((c) => !isBumpCommit(c.subject, plugin)).map((c) => `- ${c.sha} ${c.subject}`);
  return lines.length ? lines.join("\n") : `No changes under plugins/${plugin}/.`;
}

function bumpedPlugins(mainVersions, developVersions, override) {
  const develop = { ...developVersions };
  if (override) develop[override.plugin] = override.version;
  return Object.keys(develop)
    .filter((plugin) => develop[plugin] !== mainVersions[plugin])
    .sort()
    .map((plugin) => ({ plugin, version: develop[plugin] }));
}

function prTitle(bumps) {
  return bumps.map((b) => `${b.plugin} ${b.version}`).join(", ");
}

function prBody(sections) {
  return sections.map((s) => `## ${s.plugin} ${s.version}\n\n${s.notes}`).join("\n\n");
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
  parseArgs,
  parseLog,
  isBumpCommit,
  formatNotes,
  bumpedPlugins,
  prTitle,
  prBody,
};
