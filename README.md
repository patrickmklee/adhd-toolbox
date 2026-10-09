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

- **adhd-kit**: `/adhd-kit:what-were-we-doing-again` writes, picks up, or audits a session handoff. Its Stop hook saves handoffs to `~/.claude/handoffs/`.


