# Audit

An **audit** re-decides the last session's conclusions with fresh eyes, then compares. It runs when the operator asks for one, and replaces step 3 of a pick-up turn.

1. **Collect the claims.** Every Decided line, every Open leading answer, and every fork in the saving session's transcript (`~/.claude/projects/<project-slug>/<session-id>*.jsonl`): an option weighed and dropped, a decision reversed, an earlier `## Handoff` the session overwrote. The transcript keeps prompts, visible replies and tool output; thinking is stored empty, so a claim whose reason never reached a reply counts as `recall`.
2. **Answer each claim yourself first**, from primary sources only: the code, the live system, the tool's own output or `--help`, official docs. Leave the old reasoning unread until you hold your own answer, so it cannot anchor you.
3. **Compare.** Read the old reasoning in the transcript and set your answer beside it.
4. **Give a verdict.** Each claim is `confirmed`, `contradicted` or `unverifiable`, with the source you checked. An `unverifiable` verdict names what would settle it.

Done when every claim from step 1 has a verdict and a source.

The reply's first line is `Resumed <topic> from <path>; audit.`, then a table: claim | verdict | source | effect on Next. When any verdict changes Next, the turn ends with a handoff under the same topic.
