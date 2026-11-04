#!/usr/bin/env node
// Release tooling for this plugin marketplace.
// Spec: docs/superpowers/specs/2026-11-03-release-script-design.md
//
//   node scripts/release.js <patch|minor|major|X.Y.Z> [--plugin <name>] [-m "<summary>"] [--dry-run]
//   node scripts/release.js publish [--dry-run]

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// ---------- errors ----------

class ReleaseError extends Error {
  constructor(message, { next, step } = {}) {
    super(message);
    this.name = "ReleaseError";
    this.exitCode = 1;
    this.next = next;
    this.step = step;
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

// ---------- planning (pure) ----------

const GITLEAKS_HINT = "install gitleaks: winget install gitleaks";

function planBump(state) {
  const { plugin, kind, summary, dryRun } = state;
  const warnings = [];

  // Guards (spec bump step 1).
  if (state.branch !== "develop") {
    throw new ReleaseError(`must be on develop (currently on ${state.branch})`, { next: "git switch develop", step: "guards" });
  }
  if (!state.clean) {
    throw new ReleaseError("working tree is not clean", { next: "commit or stash your changes, then rerun", step: "guards" });
  }
  if (state.behind > 0) {
    throw new ReleaseError(`develop is ${state.behind} commit(s) behind origin/develop`, { next: "git pull --ff-only origin develop", step: "guards" });
  }
  if (state.ahead > 1) {
    throw new ReleaseError(`develop is ${state.ahead} commits ahead of origin/develop; push or drop them first`, { next: "git push origin develop", step: "guards" });
  }
  if (state.marketplaceHasVersion) {
    throw new ReleaseError(`.claude-plugin/marketplace.json sets a version for ${plugin}; remove it (plugin.json is the only version source)`, { step: "guards" });
  }
  if (!state.hasGitleaks) {
    if (!dryRun) throw new ReleaseError("gitleaks not found on PATH", { next: GITLEAKS_HINT, step: "guards" });
    warnings.push(`gitleaks not found on PATH; a real run will refuse (${GITLEAKS_HINT})`);
  }

  // Target (spec bump step 2).
  const target = bumpVersion(state.mainVersion, kind);
  const tag = tagName(plugin, target);
  if (compareVersions(target, state.mainVersion) <= 0) {
    throw new ReleaseError(`target ${target} is not above the released version ${state.mainVersion} on main`, { step: "target" });
  }
  const last = latestTag(state.tags, plugin);
  if (last && compareVersions(target, last.version) <= 0) {
    throw new ReleaseError(`target ${target} is not above the latest tag ${last.tag}`, { step: "target" });
  }
  if (state.tags.includes(tag)) {
    throw new ReleaseError(`tag ${tag} already exists`, { step: "target" });
  }

  const commitMessage = summary ? `${plugin} ${target}: ${summary}` : `${plugin} ${target}`;
  const explicitHint = { next: `pass an explicit version above ${state.developVersion}, e.g. node scripts/release.js ${bumpVersion(state.developVersion, "patch")}` };

  if (state.ahead === 1) {
    if (!isBumpCommit(state.headSubject, plugin, target) || state.developVersion !== target) {
      throw new ReleaseError(`develop has an unpushed commit that is not the ${plugin} ${target} bump: "${state.headSubject}"`, {
        next: "push or drop that commit, then rerun",
      });
    }
    return { target, tag, commitMessage, write: false, commit: false, push: true, warnings };
  }

  const cmp = compareVersions(state.developVersion, target);
  if (cmp > 0) {
    throw new ReleaseError(`develop already has ${plugin} ${state.developVersion}, above ${target}; pass an explicit version`, explicitHint);
  }
  if (cmp === 0) {
    return { target, tag, commitMessage, write: false, commit: false, push: false, warnings };
  }
  return { target, tag, commitMessage, write: true, commit: true, push: true, warnings };
}

function releaseExists(view) {
  if (view.status === 0) return true;
  if (/release not found/i.test(view.stderr || "")) return false;
  throw new CommandError(`gh release view failed: ${(view.stderr || "").trim() || `exit ${view.status}`}`);
}

function planPublish({ plugin, version, tags, view, hasGitleaks, dryRun }) {
  const tag = tagName(plugin, version);
  const last = latestTag(tags, plugin);
  if (last && compareVersions(version, last.version) < 0) {
    throw new ReleaseError(`${plugin} version went backwards: plugin.json has ${version}, latest tag is ${last.tag}`);
  }
  if (releaseExists(view)) return { action: "skip", tag };

  const warnings = [];
  if (!hasGitleaks) {
    if (!dryRun) throw new ReleaseError("gitleaks not found on PATH; refusing to publish without a secret scan", { next: GITLEAKS_HINT });
    warnings.push(`gitleaks not found on PATH; a real run will refuse (${GITLEAKS_HINT})`);
  }
  const below = tags.filter((t) => {
    const l = latestTag([t], plugin);
    return l && compareVersions(l.version, version) < 0;
  });
  const since = latestTag(below, plugin);
  return { action: "create", tag, since: since ? since.tag : null, warnings };
}

// ---------- command layer (impure) ----------

let ROOT = null;
let currentStep = "args";

function step(name) {
  currentStep = name;
}

function display(cmd, args) {
  return [cmd, ...args].map((a) => (/[\s"]/.test(a) ? JSON.stringify(a) : a)).join(" ");
}

function exec(cmd, args, input) {
  return spawnSync(cmd, args, {
    cwd: ROOT || undefined,
    input,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function run(cmd, args, { input, mutating = false, dryRun = false } = {}) {
  if (mutating && dryRun) {
    console.log(`[dry-run] ${display(cmd, args)}`);
    return "";
  }
  const r = exec(cmd, args, input);
  if (r.error) throw new CommandError(`${cmd} could not be started: ${r.error.message}`);
  if (r.status !== 0) {
    throw new CommandError(`${cmd} ${args[0]} failed: ${(r.stderr || r.stdout || "").trim() || `exit ${r.status}`}`);
  }
  return r.stdout.trim();
}

function scan(text) {
  const r = exec("gitleaks", ["stdin", "--no-banner", "--redact"], text);
  if (r.error && r.error.code === "ENOENT") return "missing";
  if (r.error) throw new CommandError(`gitleaks could not be started: ${r.error.message}`);
  if (r.status === 0) return "clean";
  process.stderr.write(`${r.stdout || ""}${r.stderr || ""}`);
  return "hit";
}

function repoRoot() {
  return run("git", ["rev-parse", "--show-toplevel"]);
}

function manifestPath(plugin) {
  return `plugins/${plugin}/.claude-plugin/plugin.json`;
}

function versionOf(jsonText, where) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new ReleaseError(`${where} is not valid JSON`);
  }
  if (!parsed || !VERSION_RE.test(String(parsed.version))) {
    throw new ReleaseError(`${where} has no valid X.Y.Z "version"`);
  }
  return parsed.version;
}

function readPluginVersions(ref) {
  const versions = {};
  if (ref === "WORKTREE") {
    const dir = path.join(ROOT, "plugins");
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!d.isDirectory() || !PLUGIN_RE.test(d.name)) continue;
      const file = path.join(ROOT, manifestPath(d.name));
      if (!fs.existsSync(file)) continue;
      versions[d.name] = versionOf(fs.readFileSync(file, "utf8"), manifestPath(d.name));
    }
    return versions;
  }
  const listing = run("git", ["ls-tree", "--name-only", ref, "--", "plugins/"]);
  for (const line of listing.split(/\r?\n/)) {
    const name = line.replace(/^plugins\//, "");
    if (!PLUGIN_RE.test(name)) continue;
    const r = exec("git", ["show", `${ref}:${manifestPath(name)}`]);
    if (r.status !== 0) continue; // folder without a manifest at that ref
    versions[name] = versionOf(r.stdout, `${ref}:${manifestPath(name)}`);
  }
  return versions;
}

function listTags(pattern) {
  return run("git", ["tag", "--list", pattern]).split(/\r?\n/).filter(Boolean);
}

function notesFor(plugin, since, ref) {
  const range = since ? `${since}..${ref}` : ref;
  const log = run("git", ["log", "--no-merges", "--format=%h %s", range, "--", `plugins/${plugin}/`]);
  return formatNotes(parseLog(log), plugin);
}

function marketplaceHasVersion(plugin) {
  const file = path.join(ROOT, ".claude-plugin", "marketplace.json");
  if (!fs.existsSync(file)) return false;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new ReleaseError(".claude-plugin/marketplace.json is not valid JSON");
  }
  const entry = (parsed.plugins || []).find((p) => p && p.name === plugin);
  return Boolean(entry && Object.prototype.hasOwnProperty.call(entry, "version"));
}

// ---------- bump command ----------

function bump(opts) {
  const dryRun = opts.dryRun;

  step("guards");
  run("gh", ["auth", "status"]);
  run("git", ["fetch", "origin", "--tags"]);

  const worktreeVersions = readPluginVersions("WORKTREE");
  const names = Object.keys(worktreeVersions).sort();
  let plugin = opts.plugin;
  if (!plugin) {
    if (names.length !== 1) throw new ReleaseError(`--plugin is required (plugins: ${names.join(", ")})`);
    plugin = names[0];
  }
  if (!names.includes(plugin)) throw new ReleaseError(`no plugin named "${plugin}" (plugins: ${names.join(", ")})`);

  const rel = manifestPath(plugin);
  const file = path.join(ROOT, rel);
  const text = fs.readFileSync(file, "utf8");
  const mainVersions = readPluginVersions("origin/main");

  const state = {
    plugin,
    kind: opts.kind,
    summary: opts.summary,
    dryRun,
    branch: run("git", ["rev-parse", "--abbrev-ref", "HEAD"]),
    clean: run("git", ["status", "--porcelain"]) === "",
    ahead: Number(run("git", ["rev-list", "--count", "origin/develop..HEAD"])),
    behind: Number(run("git", ["rev-list", "--count", "HEAD..origin/develop"])),
    headSubject: run("git", ["log", "-1", "--format=%s"]),
    mainVersion: mainVersions[plugin] || "0.0.0",
    developVersion: worktreeVersions[plugin],
    tags: listTags(`${plugin}--v*`),
    marketplaceHasVersion: marketplaceHasVersion(plugin),
    hasGitleaks: scan("") !== "missing",
  };

  step("target");
  const plan = planBump(state);
  for (const w of plan.warnings) console.error(`warning: ${w}`);
  console.log(`${plugin}: ${state.mainVersion} (main) -> ${plan.target}, tag ${plan.tag} on merge`);

  step("write");
  if (plan.write) {
    console.log(`${rel}: ${state.developVersion} -> ${plan.target}${dryRun ? " (dry-run, not written)" : ""}`);
    if (!dryRun) fs.writeFileSync(file, setVersion(text, plan.target));
  }

  step("commit");
  if (plan.commit) {
    try {
      run("git", ["commit", "-m", plan.commitMessage, "--", rel], { mutating: true, dryRun });
    } catch (e) {
      if (!dryRun) exec("git", ["checkout", "--", rel]);
      throw e;
    }
  }

  step("build");
  const bumps = bumpedPlugins(mainVersions, readPluginVersions("WORKTREE"), { plugin, version: plan.target });
  const allTags = listTags("*--v*");
  const sections = bumps.map((b) => {
    const last = latestTag(allTags, b.plugin);
    return { ...b, notes: notesFor(b.plugin, last ? last.tag : null, "HEAD") };
  });
  const title = prTitle(bumps);
  const body = prBody(sections);

  step("scan");
  const result = scan(`${plan.commitMessage}\n${title}\n${body}`);
  if (result === "hit") {
    throw new ReleaseError("secret scan flagged the commit message, PR title or PR body; nothing was pushed", {
      next: "fix the flagged text. If it is in the -m summary: git reset --hard origin/develop  (drops only the unpushed bump commit), then rerun with a different -m",
    });
  }
  if (result === "missing" && !dryRun) throw new ReleaseError("gitleaks not found on PATH", { next: GITLEAKS_HINT });

  if (dryRun) console.log(`PR title: ${title}\nPR body:\n${body}`);

  step("push");
  if (plan.push) run("git", ["push", "origin", "develop"], { mutating: true, dryRun });

  step("pr");
  const open = JSON.parse(
    run("gh", ["pr", "list", "--base", "main", "--head", "develop", "--state", "open", "--json", "number,url", "--limit", "1"]) || "[]",
  );
  let url;
  if (open.length) {
    run("gh", ["pr", "edit", String(open[0].number), "--title", title, "--body-file", "-"], { input: body, mutating: true, dryRun });
    url = open[0].url;
  } else {
    url = run("gh", ["pr", "create", "--base", "main", "--head", "develop", "--title", title, "--body-file", "-"], {
      input: body,
      mutating: true,
      dryRun,
    });
  }
  console.log(url ? `PR: ${url}` : "PR: (dry-run, would be created)");
}

// ---------- publish command ----------

function publish() {
  throw new ReleaseError("publish is not implemented yet");
}

// ---------- entry point ----------

async function main(argv) {
  try {
    step("args");
    const opts = parseArgs(argv);
    ROOT = repoRoot();
    if (opts.command === "publish") publish(opts);
    else bump(opts);
  } catch (e) {
    if (!(e instanceof ReleaseError || e instanceof CommandError)) throw e;
    console.error(`release: [${e.step || currentStep}] ${e.message}`);
    if (currentStep !== "args") console.error(`next: ${e.next || `rerun: node scripts/release.js ${argv.join(" ")}`}`);
    process.exitCode = e.exitCode;
  }
}

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
  planBump,
  releaseExists,
  planPublish,
  run,
  scan,
  repoRoot,
  readPluginVersions,
  notesFor,
  main,
};
