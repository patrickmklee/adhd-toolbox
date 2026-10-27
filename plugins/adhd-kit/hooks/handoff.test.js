// node --test C:/Users/patri/.claude/hooks/
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const HOOK = path.join(__dirname, "handoff.js");

function entry(type, content, extra = {}) {
  return JSON.stringify({
    type,
    message: { role: type, content },
    timestamp: new Date(Date.now() - 60_000).toISOString(),
    isSidechain: false,
    cwd: "C:\\Users\\patri\\projects\\demo",
    ...extra,
  });
}

// Build a transcript: one human prompt, optional background launches/notifications, then `tools` tool calls, then a final text.
function transcript({ tools = 0, finalText = "Done.", exitPlan = false, notificationMidTurn = false, bgLaunch = 0, bgDone = 0, prompt = "Build the thing" }) {
  const lines = [entry("user", prompt)];
  for (let i = 0; i < bgLaunch; i++) {
    lines.push(entry("assistant", [{ type: "tool_use", id: "bg" + i, name: "Agent", input: { prompt: "probe", run_in_background: true } }]));
    lines.push(entry("user", [{ type: "tool_result", tool_use_id: "bg" + i, content: "Async agent launched" }]));
  }
  for (let i = 0; i < bgDone; i++) lines.push(entry("user", "<task-notification>agent " + i + " finished</task-notification>"));
  for (let i = 0; i < tools; i++) {
    if (notificationMidTurn && i === Math.floor(tools / 2)) {
      lines.push(entry("user", "<task-notification>agent finished</task-notification>"));
    }
    const name = exitPlan && i === tools - 1 ? "ExitPlanMode" : "Bash";
    lines.push(entry("assistant", [{ type: "tool_use", id: "t" + i, name, input: { command: "ls" } }]));
    lines.push(entry("user", [{ type: "tool_result", tool_use_id: "t" + i, content: "ok" }]));
  }
  lines.push(entry("assistant", [{ type: "text", text: finalText }]));
  return lines.join("\n") + "\n";
}

function run(lines, { home, stopHookActive = false, sessionId = "sess-1234-abcd", transcriptPath, cwd = "C:\\Users\\patri\\projects\\demo" } = {}) {
  home ??= fs.mkdtempSync(path.join(os.tmpdir(), "handoff-home-"));
  const tp = transcriptPath ?? path.join(home, "transcript.jsonl");
  if (lines !== null) fs.writeFileSync(tp, lines);
  const input = JSON.stringify({
    session_id: sessionId,
    cwd,
    transcript_path: tp,
    stop_hook_active: stopHookActive,
  });
  const r = spawnSync(process.execPath, [HOOK], {
    input,
    encoding: "utf8",
    env: { ...process.env, HOME: home, USERPROFILE: home, TEMP: home, TMP: home, TMPDIR: home },
  });
  return { ...r, home };
}

const HANDOFF = "All set.\n\n## Handoff: Repo reorg\n- **Decided**: x\n- **Changed**: y\n- **Next**: you review\n";
const HANDOFF_NO_TOPIC = "All set.\n\n## Handoff\n- **Decided**: x\n- **Next**: you review\n";

test("a) short turn: silent allow", () => {
  const r = run(transcript({ tools: 5 }));
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), "");
});

test("b) heavy turn without handoff: block once with short reason", () => {
  const r = run(transcript({ tools: 25 }));
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.decision, "block");
  assert.match(out.reason, /## Handoff/);
  assert.ok(out.reason.length < 400, "reason must stay short");
});

const DEMO_DIR = (home) => path.join(home, ".claude", "handoffs", "C--Users-patri-projects-demo");

test("c) heading with topic: saved as <topic-slug>.md with provenance line, systemMessage carries the path", () => {
  const r = run(transcript({ tools: 25, finalText: HANDOFF }));
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.decision, undefined);
  assert.deepEqual(fs.readdirSync(DEMO_DIR(r.home)), ["repo-reorg.md"]);
  const file = path.join(DEMO_DIR(r.home), "repo-reorg.md");
  assert.ok(out.systemMessage.includes(file), "systemMessage names the saved path");
  const body = fs.readFileSync(file, "utf8");
  assert.match(body.split("\n")[0], /^<!-- saved \d{4}-\d{2}-\d{2} \d{2}:\d{2} session sess-123 -->$/);
  assert.ok(body.split("\n")[1].startsWith("## Handoff: Repo reorg"));
  assert.doesNotMatch(body, /All set/);
});

test("c2) heading without topic: saved as untitled-<sid8>.md", () => {
  const r = run(transcript({ tools: 25, finalText: HANDOFF_NO_TOPIC }));
  assert.deepEqual(fs.readdirSync(DEMO_DIR(r.home)), ["untitled-sess-123.md"]);
});

test("c3) short turn with a handoff (manual /handoff) is still saved", () => {
  const r = run(transcript({ tools: 2, finalText: HANDOFF }));
  assert.deepEqual(fs.readdirSync(DEMO_DIR(r.home)), ["repo-reorg.md"]);
});

test("c4) same topic saved twice: one file, newest content", () => {
  const first = run(transcript({ tools: 25, finalText: HANDOFF }));
  run(transcript({ tools: 25, finalText: HANDOFF.replace("x", "x2") }), { home: first.home });
  assert.deepEqual(fs.readdirSync(DEMO_DIR(first.home)), ["repo-reorg.md"]);
  assert.match(fs.readFileSync(path.join(DEMO_DIR(first.home), "repo-reorg.md"), "utf8"), /x2/);
});

test("topicOf / slugify handle separators and empty slugs", () => {
  const { topicOf, slugify } = require(HOOK);
  assert.equal(topicOf("## Handoff: Quiz prototype seeds"), "Quiz prototype seeds");
  assert.equal(topicOf("## Handoff - repo reorg"), "repo reorg");
  assert.equal(topicOf("## Handoff — repo reorg"), "repo reorg");
  assert.equal(topicOf("## Handoff\n- x"), null);
  assert.equal(slugify("Quiz prototype seeds"), "quiz-prototype-seeds");
  assert.equal(slugify("???"), "");
});

test("d) heavy turn that used ExitPlanMode: allow", () => {
  const r = run(transcript({ tools: 25, exitPlan: true }));
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), "");
});

test("e) same turn seen twice: second stop is allowed (nudge, not gate)", () => {
  const lines = transcript({ tools: 25 });
  const first = run(lines);
  assert.equal(JSON.parse(first.stdout).decision, "block");
  const second = run(lines, { home: first.home });
  assert.equal(second.status, 0);
  assert.equal(second.stdout.trim(), "");
});

test("f) fail open: stop_hook_active, missing transcript, malformed lines", () => {
  const a = run(transcript({ tools: 25 }), { stopHookActive: true });
  assert.equal(a.status, 0);
  assert.equal(a.stdout.trim(), "");

  const home = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-home-"));
  const b = run(null, { home, transcriptPath: path.join(home, "nope.jsonl") });
  assert.equal(b.status, 0);
  assert.equal(b.stdout.trim(), "");

  const c = run("{not json\n" + transcript({ tools: 25 }) + "garbage\n");
  assert.equal(c.status, 0);
  assert.equal(JSON.parse(c.stdout).decision, "block", "garbage lines are skipped, real turn still analysed");
});

test("g) task-notification mid-turn does not restart the turn", () => {
  const r = run(transcript({ tools: 25, notificationMidTurn: true }));
  assert.equal(JSON.parse(r.stdout).decision, "block");
});

test("h) heavy pick-up turn ending in the one-line Resumed reply: silent allow", () => {
  const r = run(transcript({ tools: 25, finalText: "Resumed Repo reorg from C:\\Users\\patri\\.claude\\handoffs\\C--x\\repo-reorg.md; Next: you review the PR." }));
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), "");
});

test("h4) heavy pick-up turn ending in Resumed plus checked-claim lines: silent allow", () => {
  const r = run(transcript({ tools: 25, finalText: "Resumed Repo reorg from C:\\Users\\patri\\.claude\\handoffs\\C--x\\repo-reorg.md; Next: you review the PR.\nconfirmed by `claude plugin validate`\ncontradicted by `--help`: Next needs `claude plugin update`" }));
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), "");
});

test("h5) pick-up reply split by a tool call: nudged, so the skill's one-final-block rule is load-bearing", () => {
  const lines = transcript({ tools: 25, finalText: "Resumed Repo reorg from C:\\Users\\patri\\.claude\\handoffs\\C--x\\repo-reorg.md; Next: you review the PR." })
    + entry("assistant", [{ type: "tool_use", id: "late", name: "Bash", input: { command: "claude --help" } }]) + "\n"
    + entry("user", [{ type: "tool_result", tool_use_id: "late", content: "ok" }]) + "\n"
    + entry("assistant", [{ type: "text", text: "contradicted by `--help`: Next needs `claude plugin update`" }]) + "\n";
  const r = run(lines);
  assert.equal(JSON.parse(r.stdout).decision, "block");
});

test("h3) heavy pick-up turn that did real work and ended with plain text: nudged like any other", () => {
  const r = run(transcript({ tools: 25, finalText: "Both probes are running now. I will pass on their results." }));
  assert.equal(JSON.parse(r.stdout).decision, "block");
});

test("n) background agents still pending: no nudge; all reported: nudge", () => {
  const pending = run(transcript({ tools: 25, bgLaunch: 2, bgDone: 1 }));
  assert.equal(pending.status, 0);
  assert.equal(pending.stdout.trim(), "");
  const done = run(transcript({ tools: 25, bgLaunch: 2, bgDone: 2 }));
  assert.equal(JSON.parse(done.stdout).decision, "block");
});

test("o) a file saved by another session is kept as .prev.md; same session overwrites in place", () => {
  const first = run(transcript({ tools: 25, finalText: HANDOFF }), { sessionId: "sess-AAAA-1111" });
  run(transcript({ tools: 25, finalText: HANDOFF.replace("x", "x2") }), { home: first.home, sessionId: "sess-BBBB-2222" });
  assert.deepEqual(fs.readdirSync(DEMO_DIR(first.home)).sort(), ["repo-reorg.md", "repo-reorg.prev.md"]);
  assert.match(fs.readFileSync(path.join(DEMO_DIR(first.home), "repo-reorg.prev.md"), "utf8"), /session sess-AAA/);
  assert.match(fs.readFileSync(path.join(DEMO_DIR(first.home), "repo-reorg.md"), "utf8"), /x2/);
  run(transcript({ tools: 25, finalText: HANDOFF.replace("x", "x3") }), { home: first.home, sessionId: "sess-BBBB-2222" });
  assert.match(fs.readFileSync(path.join(DEMO_DIR(first.home), "repo-reorg.prev.md"), "utf8"), /session sess-AAA/, "prev is not touched by a same-session resave");
  assert.match(fs.readFileSync(path.join(DEMO_DIR(first.home), "repo-reorg.md"), "utf8"), /x3/);
});

test("h2) pick-up turn that still ends with a handoff: saved", () => {
  const r = run(transcript({ tools: 25, finalText: HANDOFF }));
  assert.match(JSON.parse(r.stdout).systemMessage, /repo-reorg\.md/);
});

test("analyzeTurn counts background launches minus task notifications", () => {
  const { analyzeTurn } = require(HOOK);
  const lines = [
    entry("user", "run the probes"),
    entry("assistant", [{ type: "tool_use", id: "a", name: "Agent", input: { prompt: "x", run_in_background: true } }]),
    entry("assistant", [{ type: "tool_use", id: "b", name: "Bash", input: { command: "sleep 5", run_in_background: true } }]),
    entry("user", "<task-notification>a done</task-notification>"),
    entry("assistant", [{ type: "text", text: "waiting" }]),
  ];
  assert.equal(analyzeTurn(lines).bgPending, 1);
});

// ---- fix pass after final review ----

test("f2) stop_hook_active with a heading: the nudged handoff is still saved", () => {
  const r = run(transcript({ tools: 25, finalText: HANDOFF }), { stopHookActive: true });
  assert.match(JSON.parse(r.stdout).systemMessage, /repo-reorg\.md/);
  assert.deepEqual(fs.readdirSync(DEMO_DIR(r.home)), ["repo-reorg.md"]);
});

test("i) fenced template above the real heading: section and filename come from the last real heading", () => {
  const text = "Per the skill:\n```\n## Handoff: other\n- **Decided**: template\n```\n\n## Handoff: Repo reorg\n- **Decided**: real\n";
  const r = run(transcript({ tools: 25, finalText: text }));
  assert.deepEqual(fs.readdirSync(DEMO_DIR(r.home)), ["repo-reorg.md"]);
  const body = fs.readFileSync(path.join(DEMO_DIR(r.home), "repo-reorg.md"), "utf8");
  assert.doesNotMatch(body, /template/);
  assert.match(body, /real/);
});

test("i2) a heading that merely starts with the word Handoff is not a handoff", () => {
  const r = run(transcript({ tools: 25, finalText: "## Handoff hook changes\n- stuff\n" }));
  assert.equal(JSON.parse(r.stdout).decision, "block");
  assert.ok(!fs.existsSync(DEMO_DIR(r.home)));
});

test("j) slug comes from the transcript's first cwd, normalised, not from the Stop input cwd", () => {
  const lines = transcript({ tools: 25, finalText: HANDOFF });
  const r = run(lines, { cwd: "C:\\Users\\patri\\projects\\demo\\remix" });
  assert.deepEqual(fs.readdirSync(DEMO_DIR(r.home)), ["repo-reorg.md"]);

  const msys = [entry("user", "Build", { cwd: "/c/Users/patri/projects/demo/" })];
  for (let i = 0; i < 2; i++) msys.push(entry("assistant", [{ type: "tool_use", id: "t" + i, name: "Bash", input: {} }], { cwd: "/c/Users/patri/projects/demo/" }));
  msys.push(entry("assistant", [{ type: "text", text: HANDOFF }], { cwd: "/c/Users/patri/projects/demo/" }));
  const r2 = run(msys.join("\n") + "\n", { cwd: "/c/Users/patri/projects/demo/" });
  assert.deepEqual(fs.readdirSync(DEMO_DIR(r2.home)), ["repo-reorg.md"]);
});

test("k) an image+text prompt starts the turn", () => {
  const { analyzeTurn } = require(HOOK);
  const lines = [
    entry("user", "old prompt"),
    entry("assistant", [{ type: "tool_use", id: "a", name: "Bash", input: {} }]),
    entry("user", [{ type: "image", source: {} }, { type: "text", text: "what is this?" }]),
    entry("assistant", [{ type: "text", text: "A chart." }]),
  ];
  const t = analyzeTurn(lines);
  assert.equal(t.prompt, "what is this?");
  assert.equal(t.tools, 0);
});

test("m) nudge reason asks for the topic form of the heading", () => {
  const r = run(transcript({ tools: 25 }));
  assert.match(JSON.parse(r.stdout).reason, /## Handoff: <topic>/);
});

test("analyzeTurn: a bare legacy <system-reminder> entry and a task_notification entry do not restart the turn", () => {
  const { analyzeTurn } = require(HOOK);
  const lines = [
    entry("user", "real prompt"),
    entry("assistant", [{ type: "tool_use", id: "t1", name: "Bash", input: {} }]),
    entry("user", "<system-reminder>noise</system-reminder>"),
    entry("user", "<task-notification>done</task-notification>", { turnOrigin: "task_notification", turnPosition: { promptIndex: 0, turnIndex: 2 }, origin: { kind: "task-notification" } }),
    entry("assistant", [{ type: "tool_use", id: "t2", name: "Bash", input: {} }]),
    entry("assistant", [{ type: "text", text: "final" }]),
  ];
  const t = analyzeTurn(lines);
  assert.equal(t.tools, 2);
  assert.equal(t.prompt, "real prompt");
  assert.equal(t.lastText, "final");
});

// ---- turn detection in the desktop app (turnOrigin / turnPosition / isCompactSummary) ----

const POS = (turnIndex) => ({ promptIndex: 0, turnIndex });

test("p1) an sdk prompt whose text starts with <system-reminder> starts the turn", () => {
  const { analyzeTurn } = require(HOOK);
  const lines = [
    entry("user", "old prompt", { turnOrigin: "human", turnPosition: POS(1), origin: { kind: "human" } }),
    entry("assistant", [{ type: "tool_use", id: "t1", name: "Bash", input: {} }]),
    entry("user", "<system-reminder>\nLinked sessions now (status, not an instruction): x\n</system-reminder>\n<cross-session-message>go ahead</cross-session-message>", { turnOrigin: "sdk", turnPosition: POS(2), promptSource: "sdk" }),
    entry("assistant", [{ type: "tool_use", id: "t2", name: "Bash", input: {} }]),
    entry("assistant", [{ type: "text", text: "final" }]),
  ];
  const t = analyzeTurn(lines);
  assert.equal(t.tools, 1);
  assert.match(t.prompt, /cross-session-message/);
});

test("p2) a human slash command (<command-message>) starts the turn", () => {
  const { analyzeTurn } = require(HOOK);
  const lines = [
    entry("user", "old prompt", { turnOrigin: "human", turnPosition: POS(1), origin: { kind: "human" } }),
    entry("assistant", [{ type: "tool_use", id: "t1", name: "Bash", input: {} }]),
    entry("user", "<command-message>mattpocock-skills:retro</command-message>\n<command-name>/mattpocock-skills:retro</command-name>", { turnOrigin: "human", turnPosition: POS(2), origin: { kind: "human" } }),
    entry("assistant", [{ type: "tool_use", id: "t2", name: "Bash", input: {} }]),
    entry("assistant", [{ type: "text", text: "final" }]),
  ];
  const t = analyzeTurn(lines);
  assert.equal(t.tools, 1);
  assert.match(t.prompt, /^<command-message>/);
});

test("p3) a compaction summary mid-turn does not restart the turn", () => {
  const { analyzeTurn } = require(HOOK);
  const lines = [
    entry("user", "<system-reminder>x</system-reminder>\n<cross-session-message>go</cross-session-message>", { turnOrigin: "sdk", turnPosition: POS(2), promptSource: "sdk" }),
    entry("assistant", [{ type: "tool_use", id: "t1", name: "Bash", input: {} }]),
    entry("assistant", [{ type: "tool_use", id: "t2", name: "Bash", input: {} }]),
    entry("user", "This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion.", { turnOrigin: "sdk", turnPosition: POS(1), isCompactSummary: true, isVisibleInTranscriptOnly: true }),
    entry("assistant", [{ type: "tool_use", id: "t3", name: "Bash", input: {} }]),
    entry("assistant", [{ type: "text", text: "final" }]),
  ];
  const t = analyzeTurn(lines);
  assert.equal(t.tools, 3);
  assert.match(t.prompt, /cross-session-message/);
});

test("p4) legacy entry (no turnPosition): leading <system-reminder> block followed by text starts the turn", () => {
  const { analyzeTurn } = require(HOOK);
  const lines = [
    entry("user", "old prompt"),
    entry("assistant", [{ type: "tool_use", id: "t1", name: "Bash", input: {} }]),
    entry("user", "<system-reminder>\nnoise\n</system-reminder>\n<system-reminder>more</system-reminder>\nBuild the thing"),
    entry("assistant", [{ type: "tool_use", id: "t2", name: "Bash", input: {} }]),
    entry("assistant", [{ type: "text", text: "final" }]),
  ];
  const t = analyzeTurn(lines);
  assert.equal(t.tools, 1);
  assert.match(t.prompt, /Build the thing/);
});

test("p5) legacy compaction summary (no isCompactSummary flag) does not restart the turn", () => {
  const { analyzeTurn } = require(HOOK);
  const lines = [
    entry("user", "old prompt"),
    entry("assistant", [{ type: "tool_use", id: "t1", name: "Bash", input: {} }]),
    entry("user", "This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion."),
    entry("assistant", [{ type: "tool_use", id: "t2", name: "Bash", input: {} }]),
    entry("assistant", [{ type: "text", text: "final" }]),
  ];
  const t = analyzeTurn(lines);
  assert.equal(t.tools, 2);
  assert.equal(t.prompt, "old prompt");
});

test("p6) end to end: heavy turn whose sdk prompt starts with <system-reminder> is nudged", () => {
  const r = run(transcript({ tools: 25, prompt: "<system-reminder>\nLinked sessions now\n</system-reminder>\n<cross-session-message>go</cross-session-message>", promptExtra: { turnOrigin: "sdk", turnPosition: POS(2), promptSource: "sdk" } }));
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).decision, "block");
});

// ---- the app's wrap_up box closes the turn; the hook stays quiet ----

function wrapUpCall() {
  return entry("assistant", [{ type: "tool_use", id: "wu", name: "mcp__ccd_turn__wrap_up", input: { recap: "done" } }]) + "\n"
    + entry("user", [{ type: "tool_result", tool_use_id: "wu", content: "ok" }]) + "\n";
}

test("w1) heavy turn that called mcp__ccd_turn__wrap_up: silent allow", () => {
  const lines = transcript({ tools: 25, finalText: "Working." }) + wrapUpCall() + entry("assistant", [{ type: "text", text: "All done; see the PR." }]) + "\n";
  const r = run(lines);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), "");
});

test("w2) heavy turn with wrap_up that still ends with a handoff: saved", () => {
  const lines = transcript({ tools: 25, finalText: "Working." }) + wrapUpCall() + entry("assistant", [{ type: "text", text: HANDOFF }]) + "\n";
  const r = run(lines);
  assert.match(JSON.parse(r.stdout).systemMessage, /repo-reorg\.md/);
});

// ---- handoffs saved from a git worktree land under the main checkout's slug ----

function gitRepoWithWorktree() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "handoff-repo-")));
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo);
  const git = (args, cwd = repo) => {
    const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  git(["init", "-q"]);
  git(["commit", "-q", "--allow-empty", "-m", "init"]);
  const wt = path.join(repo, ".claude", "worktrees", "feature-x");
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  git(["worktree", "add", "-q", wt]);
  fs.mkdirSync(path.join(repo, "sub"));
  return { repo, wt, sub: path.join(repo, "sub") };
}

function transcriptAt(cwd) {
  const lines = [entry("user", "Build", { cwd })];
  for (let i = 0; i < 2; i++) lines.push(entry("assistant", [{ type: "tool_use", id: "t" + i, name: "Bash", input: {} }], { cwd }));
  lines.push(entry("assistant", [{ type: "text", text: HANDOFF }], { cwd }));
  return lines.join("\n") + "\n";
}

function handoffDirs(home) {
  return fs.readdirSync(path.join(home, ".claude", "handoffs")).map((d) => d.toLowerCase());
}

test("q1) a turn whose cwd is a linked worktree saves under the main checkout's slug", () => {
  const { slugOf } = require(HOOK);
  const { repo, wt } = gitRepoWithWorktree();
  const r = run(transcriptAt(wt), { cwd: wt });
  assert.deepEqual(handoffDirs(r.home), [slugOf(repo).toLowerCase()]);
});

test("q2) a turn whose cwd is a subdirectory of the main checkout keeps its own slug", () => {
  const { slugOf } = require(HOOK);
  const { sub } = gitRepoWithWorktree();
  const r = run(transcriptAt(sub), { cwd: sub });
  assert.deepEqual(handoffDirs(r.home), [slugOf(sub).toLowerCase()]);
});

test("q3) a cwd that is no git checkout at all keeps its own slug (fail open)", () => {
  const { slugOf } = require(HOOK);
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "handoff-plain-")));
  const r = run(transcriptAt(dir), { cwd: dir });
  assert.deepEqual(handoffDirs(r.home), [slugOf(dir).toLowerCase()]);
});

test("n2) a task-notification recorded as an attachment entry (desktop app) closes its background launch", () => {
  const { analyzeTurn } = require(HOOK);
  const lines = [
    entry("user", "run it"),
    entry("assistant", [{ type: "tool_use", id: "a", name: "Bash", input: { command: "sleep 5", run_in_background: true } }]),
    entry("user", [{ type: "tool_result", tool_use_id: "a", content: "started" }]),
    JSON.stringify({ type: "attachment", isSidechain: false, attachment: { type: "queued_command", prompt: "<task-notification><task-id>x</task-id><tool-use-id>a</tool-use-id><status>completed</status></task-notification>" } }),
    entry("assistant", [{ type: "text", text: "done" }]),
  ];
  assert.equal(analyzeTurn(lines).bgPending, 0);
});
