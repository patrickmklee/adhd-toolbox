# AGENTS.md

This repository is a small plugin toolbox for agent workflows. The top-level project is intentionally lightweight: it stores reusable plugin assets under `plugins/<plugin-name>/` and keeps each plugin self-contained.

## Project map

- [README.md](README.md): minimal project overview.
- `plugins/<plugin-name>/`: plugin root for a reusable agent feature.
  - `hooks/`: Claude/agent stop hooks and their runtime config. The existing `handoff.js` script is the reference implementation.
  - `skills/`: promptable workflow skills, each usually in its own folder with a `SKILL.md` file.
  - `agents/`, `commands/`, `scripts/`: optional plugin components when a plugin needs sub-agents, slash commands, or helper scripts.

## Working conventions

- Prefer plugin-local changes. Keep implementation details inside the matching `plugins/<plugin-name>/` folder instead of adding broad project-level abstractions.
- Favor small, dependency-free JavaScript utilities. This repo does not appear to use a package manager or app framework; the existing work is plain Node.js.
- Preserve fail-open behavior in hooks and command wrappers. When parsing transcripts or external state, treat missing or malformed data as non-fatal unless the workflow explicitly requires strict failure.
- Keep naming consistent with the existing plugin patterns: slugified topic names, plugin-scoped folders, and clear hook names.
- Use the existing handoff hook as the model for new workflow automation: explicit file paths, resilient parsing, and targeted automated tests.

## Validation

- Run the relevant Node test directly, for example:
  - `node --test "plugins/adhd-kit/hooks/handoff.test.js"`
- If a behavior change affects a plugin hook, add or update a small test next to the implementation before treating it as complete.
- Prefer minimal, local verification over broad repo-wide scaffolding or framework changes.

## Reference files

- [plugins/adhd-kit/hooks/handoff.js](plugins/adhd-kit/hooks/handoff.js)
- [plugins/adhd-kit/hooks/handoff.test.js](plugins/adhd-kit/hooks/handoff.test.js)
- [plugins/adhd-kit/skills/what-were-we-doing-again/SKILL.md](plugins/adhd-kit/skills/what-were-we-doing-again/SKILL.md)
- [plugins/adhd-kit/hooks/hooks.json](plugins/adhd-kit/hooks/hooks.json)

## When adding a new plugin

- Create a new folder under `plugins/` with a clear plugin name.
- Put plugin-specific runtime files in the relevant subfolder (`hooks`, `skills`, `agents`, etc.).
- Add a focused test for any behavior that is expected to be repeated or regression-guarded.
- Keep the plugin self-contained and easy to reuse by other agent workflows.
