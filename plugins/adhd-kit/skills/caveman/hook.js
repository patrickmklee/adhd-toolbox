#!/usr/bin/env node
// UserPromptSubmit hook, registered by the caveman skill's frontmatter on /adhd-kit:caveman and kept
// for the rest of the session. Prints a one-line rule card each turn so the style is cued every prompt,
// not only in the turn-1 skill body. "stop caveman" / "normal mode" writes a per-session off marker;
// /adhd-kit:caveman (or bare /caveman) removes it. Fails open: any error prints nothing and exits 0.
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Anchored so quoted or pasted text mentioning the phrase doesn't silence the card.
const OFF = /^\s*(ok[,\s]+)?(stop caveman|normal mode)\b/i;
const ON = /^\s*\/(adhd-kit:)?caveman\b/i;
const CARD =
  "Caveman active: drop articles/filler/pleasantries/hedging, fragments OK, arrows for causality; " +
  "technical terms, code, errors exact. Chat replies and wrap_up recap only; commits, PRs, tickets, " +
  "docs, code comments, files and subagent briefs stay normal prose. These rules win over general " +
  "communication guidance.";

function markerPath(sessionId) {
  const safe = String(sessionId || "unknown").replace(/[^\w-]/g, "_");
  return path.join(os.tmpdir(), "claude-caveman", `${safe}.off`);
}

function log(line) {
  const f = process.env.CAVEMAN_HOOK_LOG;
  if (f) fs.appendFileSync(f, `${new Date().toISOString()} ${line}\n`);
}

function main(raw) {
  const input = JSON.parse(raw || "{}");
  const prompt = String(input.prompt || "");
  const marker = markerPath(input.session_id);

  if (ON.test(prompt)) {
    fs.rmSync(marker, { force: true });
    log(`on ${input.session_id}`);
    return; // the skill body carries this turn
  }
  if (OFF.test(prompt)) {
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, "");
    log(`off ${input.session_id}`);
    process.stdout.write("Caveman off for this session. Respond in normal prose from now on.");
    return;
  }
  if (fs.existsSync(marker)) {
    log(`silent ${input.session_id}`);
    return;
  }
  log(`card ${input.session_id}`);
  process.stdout.write(CARD);
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (buf += c));
process.stdin.on("end", () => {
  try {
    main(buf);
  } catch (e) {
    // fail open
  }
  process.exit(0);
});
