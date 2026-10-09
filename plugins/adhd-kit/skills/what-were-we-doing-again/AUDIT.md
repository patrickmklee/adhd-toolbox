# Audit

An **audit** re-decides the last session's conclusions with fresh eyes, then compares. It runs when the operator asks for one, after steps 1 and 2 of a pick-up turn, in place of steps 3 and 4.

1. **Collect the claims.** Every Decided line and Open leading answer in the handoff, and every fork in the saving session's transcript: an option weighed and dropped, a decision reversed, an earlier `## Handoff` the session overwrote. A claim whose reason never reached a visible reply counts as `recall`.
2. **Strip each claim to a bare question** that does not give the old answer: "Does a skill have a variable for its plugin's name?", not "No plugin-name variable exists".
3. **Answer the questions across a context boundary.** You have read the old reasoning, so your own answers would echo it. Dispatch one subagent with only the question list and the working directory, and have it answer each question from primary sources (the code, the live system, the tool's own output or `--help`, official docs), citing its source per answer. With no subagent tool, answer yourself and title the reply `audit (anchored)`.
4. **Compare** each fresh answer with the old claim and its reasoning in the transcript.
5. **Give a verdict.** Each claim is `confirmed`, `contradicted` or `unverifiable`, with the source the fresh answer cited. An `unverifiable` verdict names what would settle it.

Done when every claim from step 1 has a verdict and a source.

Reply in one final text block: the first line is `Resumed <topic> from <path>; audit.`, then a table: claim | verdict | source | effect on Next. When any verdict changes Next, the turn ends with a handoff under the same topic.
