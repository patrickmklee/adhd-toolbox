#!/usr/bin/env node
// Claude Code Stop hook: save a `## Handoff: <topic>` section to ~/.claude/handoffs/<project-slug>/<topic-slug>.md
// whenever a turn ends with one, and nudge once for it after a heavy turn. Fails open on every error. No deps.
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const MIN_TOOLS = 20;
// A real handoff heading: "## Handoff" alone, or "## Handoff<sep> topic". Nothing else on the line.
const HEADING = /^#{1,3}[ \t]*Handoff(?:[ \t]*[:\-\u2013\u2014][ \t]*([^\n]{1,80}?))?[ \t]*$/gim;
const SYSTEM_PREFIX = /^\s*<(command-message|system-reminder|task-notification|local-command)/;
// The desktop app prefixes real prompts with injected <system-reminder> blocks; strip them before the text test.
const LEADING_REMINDERS = /^(?:\s*<system-reminder>[\s\S]*?<\/system-reminder>)+\s*/;
const COMPACT_SUMMARY = /^\s*This session is being continued from a previous conversation/;
const TASK_NOTIFICATION = /^\s*<task-notification/;
// The pick-up turn's one-line reply ("Resumed <topic> from <path>; Next: …") is a complete turn ending.
const RESUMED_LINE = /^\s*Resumed\b[^\n]*\bfrom\b/i;
const SAVED_LINE = /^<!-- saved [^\n]* session ([\w-]+) -->/;

function promptText(o) {
  if (o.type !== "user" || o.isMeta || o.isSidechain) return null;
  const c = o.message && o.message.content;
  if (typeof c === "string") return c;
  if (!Array.isArray(c) || !c.length || c.some((b) => b.type === "tool_result")) return null;
  const texts = c.filter((b) => b.type === "text").map((b) => b.text || "");
  return texts.length ? texts.join("") : null;
}

// Does this user entry start a turn? Newer transcripts (Claude Code 2.1.308+) tag every prompt-like entry with
// turnOrigin: "human" and "sdk" start a turn, "task_notification" continues one, and a compaction summary never
// starts one (it lands mid-turn and carries isCompactSummary). Older transcripts get the text test, after the
// leading <system-reminder> blocks the app injects ahead of the real prompt are stripped.
function isHumanPrompt(o) {
  const t = promptText(o);
  if (t === null || o.isCompactSummary || COMPACT_SUMMARY.test(t)) return false;
  if (typeof o.turnOrigin === "string") return o.turnOrigin === "human" || o.turnOrigin === "sdk";
  const body = t.replace(LEADING_REMINDERS, "");
  return body.trim() !== "" && !SYSTEM_PREFIX.test(body);
}

// Replace fenced code blocks with same-length spaces so headings inside them never match.
function maskFences(text) {
  return text.replace(/```[\s\S]*?(```|$)/g, (m) => " ".repeat(m.length));
}

// Returns { index, topic } of the LAST real handoff heading, or null.
function findHeading(text) {
  const masked = maskFences(String(text));
  let last = null, m;
  HEADING.lastIndex = 0;
  while ((m = HEADING.exec(masked)) !== null) last = { index: m.index, topic: m[1] ? m[1].trim() : null };
  return last;
}

// Walk the transcript (array of JSONL strings) and describe the last turn.
// bgPending counts background launches (Agent/Bash with run_in_background) whose task-notification has not arrived.
function analyzeTurn(lines) {
  const turn = { prompt: null, promptTs: null, cwd: null, tools: 0, exitPlan: false, bgPending: 0, wrapUp: false, lastText: "" };
  const entries = [];
  for (const line of lines) {
    try { const o = JSON.parse(line); if (o && typeof o === "object") entries.push(o); } catch { /* skip garbage */ }
  }
  for (const o of entries) if (o.cwd) { turn.cwd = o.cwd; break; }
  let start = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (isHumanPrompt(entries[i])) { start = i; break; }
  }
  if (start < 0) return turn;
  turn.prompt = promptText(entries[start]);
  turn.promptTs = entries[start].timestamp || null;
  for (const o of entries.slice(start + 1)) {
    if (o.isSidechain) continue;
    // The desktop app records a notification that lands mid-turn as an attachment (queued_command), not a user entry.
    if (o.type === "attachment") {
      const p = o.attachment && o.attachment.prompt;
      if (typeof p === "string" && TASK_NOTIFICATION.test(p) && turn.bgPending > 0) turn.bgPending--;
      continue;
    }
    if (o.type === "user") {
      const t = promptText(o);
      if (t !== null && TASK_NOTIFICATION.test(t) && turn.bgPending > 0) turn.bgPending--;
      continue;
    }
    if (o.type !== "assistant") continue;
    for (const b of (o.message && o.message.content) || []) {
      if (b.type === "tool_use") {
        turn.tools++;
        if (b.name === "ExitPlanMode") turn.exitPlan = true;
        if (b.name === "mcp__ccd_turn__wrap_up") turn.wrapUp = true; // the desktop app's next-step box closes the turn
        if (b.input && b.input.run_in_background === true) turn.bgPending++;
      } else if (b.type === "text" && b.text && b.text.trim()) turn.lastText = b.text;
    }
  }
  return turn;
}

// A linked git worktree is deleted after merge, so a handoff keyed on its path is stranded. Key it on the main
// checkout instead: the parent of `git rev-parse --git-common-dir`. Any other cwd (a subdirectory of the main
// checkout, no git, no repo, MSYS path) keeps its own slug. Fails open to cwd.
function projectRoot(cwd) {
  if (!cwd) return cwd;
  try {
    const r = spawnSync("git", ["rev-parse", "--git-dir", "--git-common-dir"], { cwd, encoding: "utf8", timeout: 2000, windowsHide: true });
    if (r.status !== 0 || !r.stdout) return cwd;
    const [gitDir, commonDir] = r.stdout.split(/\r?\n/).map((s) => (s.trim() ? path.resolve(cwd, s.trim()) : ""));
    if (!gitDir || !commonDir || gitDir === commonDir) return cwd;
    return path.dirname(commonDir);
  } catch { return cwd; }
}

// Normalise a cwd (Windows, MSYS /c/..., trailing separators) and slug it the way ~/.claude/projects does.
function slugOf(cwd) {
  let s = String(cwd || "unknown").trim();
  const msys = s.match(/^\/([a-zA-Z])\/(.*)$/);
  if (msys) s = `${msys[1].toUpperCase()}:\\${msys[2]}`;
  s = s.replace(/\//g, "\\").replace(/[\\]+$/, "");
  return s.replace(/[:\\]/g, "-");
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

function topicOf(text) {
  const h = findHeading(text);
  return h ? h.topic : null;
}

function localStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Saves the section as <topic-slug>.md (or untitled-<sid8>.md), one file per topic; returns the path.
// A version saved by a different session is kept as <topic-slug>.prev.md before it is replaced, so a
// pick-up turn that rewrites the handoff cannot erase the evidence the earlier session left.
function saveHandoff(input, turn, heading) {
  const section = turn.lastText.slice(heading.index).trim() + "\n";
  const sid = String(input.session_id || "nosession").slice(0, 8);
  const name = slugify(heading.topic || "") || `untitled-${sid}`;
  const dir = path.join(os.homedir(), ".claude", "handoffs", slugOf(projectRoot(turn.cwd || input.cwd)));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.md`);
  if (fs.existsSync(file)) {
    const old = fs.readFileSync(file, "utf8");
    const m = old.match(SAVED_LINE);
    if (m && m[1] !== sid) fs.writeFileSync(path.join(dir, `${name}.prev.md`), old);
  }
  fs.writeFileSync(file, `<!-- saved ${localStamp()} session ${sid} -->\n${section}`);
  return file;
}

// Returns a JSON-able decision or null (allow).
function decide(input) {
  const lines = fs.readFileSync(input.transcript_path, "utf8").split("\n").filter(Boolean);
  const turn = analyzeTurn(lines);
  const heading = findHeading(turn.lastText);
  if (heading) {
    const file = saveHandoff(input, turn, heading);
    return { systemMessage: `Handoff saved: ${file}` };
  }
  if (input.stop_hook_active) return null;
  if (turn.tools < MIN_TOOLS || turn.exitPlan) return null;
  if (turn.bgPending > 0) return null; // the turn is still open: results are on their way
  if (turn.wrapUp) return null; // the app's next-step box already closed the turn; a handoff after it only repeats
  if (RESUMED_LINE.test(turn.lastText)) return null; // pick-up one-liner is a complete ending

  const markerDir = path.join(os.tmpdir(), "claude-handoff");
  fs.mkdirSync(markerDir, { recursive: true });
  const marker = path.join(markerDir, `${String(input.session_id).replace(/[^\w-]/g, "_")}-${String(turn.promptTs).replace(/[^\w]/g, "")}`);
  if (fs.existsSync(marker)) return null; // nudged already this turn
  fs.writeFileSync(marker, "");
  return {
    decision: "block",
    reason: `This turn made ${turn.tools} tool calls. End your message with one \`## Handoff: <topic>\` section (topic = two to four words naming the thread, the same words as last time; ≤200 words) with the slots that apply: Decided (with why), Changed (commits/PR/doc), Verified, Open (questions + leading answer), Next (one action with its exact values, whose). The what-were-we-doing-again skill has the template.`,
  };
}

if (require.main === module) {
  try {
    const input = JSON.parse(fs.readFileSync(0, "utf8"));
    const out = decide(input);
    if (out) process.stdout.write(JSON.stringify(out));
  } catch { /* fail open */ }
  process.exit(0);
}

module.exports = { analyzeTurn, decide, topicOf, slugify, slugOf, projectRoot, findHeading, MIN_TOOLS };
