## Agent Toolbox

## Description
Personal marketplace for my agent plugins, hooks, and skills

## Install

```bash
claude plugin marketplace add patrickmklee/adhd-toolbox
claude plugin install adhd-kit@agent-toolbox
```

Pull a new release, then restart Claude Code:

```bash
claude plugin marketplace update agent-toolbox
claude plugin update adhd-kit@agent-toolbox
```

## Plugins

- **adhd-kit**: `/adhd-kit:what-were-we-doing-again` writes, picks up, or audits a session handoff. Its Stop hook saves handoffs to `~/.claude/handoffs/`. `/adhd-kit:caveman` switches replies to a terse, low-token style for the rest of the session (say "stop caveman" to turn it off).

## Releasing

A release has two steps: a local command, then a PR merge. The version lives only in `plugins/<name>/.claude-plugin/plugin.json`. Don't add a `version` to `.claude-plugin/marketplace.json`; the script refuses to run if one is there.

1. On a clean, up-to-date `develop`, run one of:

   ```bash
   node scripts/release.js minor
   ```

   - The argument is `patch`, `minor`, `major`, or an exact version such as `1.2.3`.
   - Add `-m "<summary>"` to append a summary to the commit message.
   - Add `--plugin <name>` once the marketplace has more than one plugin.
   - Add `--dry-run` to see every step without changing anything.

   The script bumps `plugin.json` from the version currently on `main`, commits `adhd-kit X.Y.Z`, pushes `develop`, and opens or updates the `develop → main` PR. If it fails partway, rerun the same command; it skips the steps that already happened.

2. Merge the PR **with a merge commit**. Squash and rebase merges are disabled, because the PR notes are built on `develop` and the Release notes on `main`, and both must see the same commits. After the merge, the [release workflow](.github/workflows/release.yml) runs `node scripts/release.js publish`. It creates the tag `<plugin>--v<version>` (e.g. `adhd-kit--v0.4.0`) and a GitHub Release. If the Release already exists, it does nothing.

**Release notes** list the subjects (never the bodies) of non-merge commits that touch `plugins/<name>/` since that plugin's previous tag. Changes to the root `marketplace.json`, this README and `scripts/` aren't listed. Bump commits are left out.

**Secret scan:** the PR text and the Release notes are scanned with [gitleaks](https://github.com/gitleaks/gitleaks) before anything is pushed or published, and a hit aborts. Locally, install it with `winget install gitleaks`; the script refuses to run without it, except under `--dry-run`.

**One-time setup:**

```bash
gh api -X PATCH repos/patrickmklee/adhd-toolbox -F allow_squash_merge=false -F allow_rebase_merge=false
```


