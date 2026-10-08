---
name: what-were-we-doing-again
description: Write or resume a handoff. Fire when the Stop hook asks for one, when the operator types /patrick-kit:what-were-we-doing-again or is stepping away, when a turn ends with the operator holding the next action, or when a prompt names a handoff file, says resume or pick up, asks where we left off, or asks what was open or next last session.
---

# Handoff

A **handoff** is a `## Handoff: <topic>` section of at most 200 words that closes a turn so the operator, or a fresh session, can act on Next with nothing else in hand. The Stop hook saves it to `~/.claude/handoffs/<project-slug>/<topic-slug>.md`, keeps the version it replaced as `<topic-slug>.prev.md`, and asks for one when a turn with 20+ tool calls ends without it.

## Which turns end with one

One handoff per turn, as the final section, when any of these holds:

- the hook asked for one;
- the operator typed `/patrick-kit:what-were-we-doing-again` or is stepping away: write it for the state right now, then stop;
- the turn leaves the operator holding the next action: a question to answer, a PR to merge, something to publish.

Every other turn ends plainly: an answer, a commit, a push, a paste acknowledged. A thread that got a handoff last turn earns another only when one of the cases above comes round again. Background agents still running mean the turn is still open: the handoff waits for their results.

## Template

```
## Handoff: <topic>
- **Decided**: <choice> because <why>. One line per decision.
- **Changed**: <commits, PR link, doc path>, or "nothing, decisions only".
- **Verified**: <what ran and passed>, or "not verified".
- **Open**: <question> → leading answer: <…>. One line each.
- **Next**: <one concrete action, with every value it depends on> (you | me).
```

Bullet form, exactly as above. The handoff is the summary: the message above it holds only what no slot carries, and repeats nothing from it. Over 200 words, the surplus goes in the PR body or the doc and the handoff links to it.

**Topic** is two to four words naming the thread, fixed for the thread's life. The thread is the operator's question, so `MSTR postmortem` stays `MSTR postmortem` through its tickets, commits and pushes. A new topic opens only when the operator opens a different question. The topic is the filename, so a renamed topic strands the old file with a stale Next.

**Omit** a slot with nothing to say. "Decided: nothing new" and an empty Open are omissions written out.

**Changed** holds only artefacts this session produced. What the operator did goes in Decided or Verified, named as theirs.

**Open** is a question only the operator can settle, with your leading answer. A yes the operator gives anyway ("push?") is Next.

**Next** stands alone. The exact cron, path, command or number the action depends on is written inside Next even when the chat already said it: the chat does not survive the gap and the handoff does.

## Shape by deliverable

- **Code**: Changed = commits and PR. Add the two or three riskiest spots a reviewer should read first. When a PR exists, this section is the PR body.
- **Interview or design** (grilling, brainstorming): Decided = answers given so far. Open = the frontier: every unresolved question, with a leading answer only where you hold one.
- **Research or prototype**: Changed = the doc or prototype path. Open = claims not yet checked against a primary source.
- **Waiting on the operator**: Open holds the question. Next names the operator.

## Picking up

A **pick-up turn** is one whose prompt names a handoff file or says resume or pick up. It starts by listing `~/.claude/handoffs/<project-slug>/` (slug = the session's starting cwd with `:` `\` `/` replaced by `-`). Each `.md` is one topic; its first line holds the saved time and the saving session's id. `.prev.md` files are history and stay out of the listing.

- A named topic matches a file → open it.
- No topic named and one file → open it.
- Otherwise → ask one question listing each topic with its saved time. Open a file only after the answer.

Then compare the handoff with the live state, in this order:

1. Read every artefact Next and Changed name: `git log`, `gh pr diff`, the doc, the live system.
2. Decide which of three states holds.
   - **Next done** or **Next still pending** → the whole reply is one line, `Resumed <topic> from <path>; Next: <Next verbatim, or "done; next is …">.`, and the turn ends there.
   - **State moved where the handoff did not predict** → open the saving session's transcript before asking anything. The file's first line names the session id, and `~/.claude/projects/<project-slug>/<session-id>*.jsonl` holds that session's full exchange; grep it for the artefact. Most surprises are things that session asked the operator to do. The reply is the same one line with `state moved` in place of Next, then one line for what the transcript settles, then one line per question it cannot settle, each with your leading answer. Five lines at most.

The pick-up turn leaves the handoff file as it is. When the prompt also carries a task, the pick-up is the first line and the task runs as a normal turn below it.

## Example (interview, 70 words)

```
## Handoff: coach digest
- **Decided**: Resend sends (already integrated). Monday 07:00 in the coach's timezone. Opt-out per coach, default on. Zero athletes → no email.
- **Changed**: nothing, decisions only.
- **Open**: names vs anonymised for U18 → leading: names, U18 as aggregate. React Email vs HTML string → no lead yet. Scheduler → check what production uses first.
- **Next**: you answer the two Open items; then I run round 3 (retries, "performance" definition, audit table).
```

## Not a handoff

The task restated, every file touched, pasted test output, your reasoning steps, answers to questions nobody asked, a second copy of a handoff already given this turn.
