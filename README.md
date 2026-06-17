# Praktor

> *Boule deliberates; Praktor acts.*

**Praktor** (Greek πράκτωρ, "the doer / agent that accomplishes") is an autonomous CLI that **implements the Tasks produced by [Boule](https://github.com/kleroterionlabs/boule)**. It claims a ready Task from GitHub, drives a Claude Agent SDK coder to write the change and its tests, runs the repo's own checks, opens a PR, and coordinates with peer runners through **GitHub Discussions** — all GitHub-native, no server or database.

## How it fits with Boule

| | Boule | Praktor |
|---|---|---|
| Role | Product/program management | Software engineering |
| Output | Designs → Requirements → **Tasks** (typed Issues) | Code + tests + **Pull Requests** |
| Writes | GitHub Issues/Projects/Discussions only | The working tree (Read/Write/Edit/Bash), then a PR |

Praktor **respects Boule's process**: it only picks up Tasks that are `status:accepted`, whose native `blocked_by` dependencies are all closed, and that aren't already taken (`praktor:in-progress`). Each Task's `Verifies: #<REQ>` link gives the coder the requirement(s) — with their Gherkin acceptance criteria — that the change must satisfy. It honors Boule's `boule:halt` kill-switch.

## Commands

```
praktor doctor              # validate config, creds, repo + coordination category
praktor next                # list Tasks ready to implement (accepted + unblocked)
praktor status              # snapshot: accepted / ready / in-progress / claims
praktor implement [task]    # claim one ready task, implement it, open a PR
```

`[task]` is a `#number` or a `boule-id`; omit it to take the first ready task.

## Configuration

Reads the same environment as Boule so it drops into the same repo/CI secrets:

- `PRAKTOR_REPO` / `BOULE_REPO` / `GITHUB_REPOSITORY` — `owner/name`
- Auth: `GITHUB_TOKEN` (fine-grained PAT) **or** the `BOULE_APP_*` GitHub App trio
- `CLAUDE_CODE_OAUTH_TOKEN` (or `ANTHROPIC_API_KEY`) for the agent

Global flags: `--repo`, `--project`, `--budget <usd>`, `--max-turns <n>`, `--dry-run`, `--json`, `-v`.

## Coordination (Discussions)

Before working a task, Praktor posts a **claim** in the `Agent Handoffs` Discussion category (configurable) with a machine-readable marker, and re-checks after claiming to yield on a race. Claims expire after a TTL so a crashed run never deadlocks the backlog. This is a cooperative lock, not a transaction — sized for a handful of parallel runners.

## License

MIT
