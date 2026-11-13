# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0]

### Added

- Plans view for Claude Code, Cursor, Copilot and plain `PLAN.md` plans, grouped Pending / Approved / Rejected / Done, with live refresh.
- Review panel with rendered plan, Cursor todos, inline comments (stored in `.kogentic/reviews/`), and Approve / Request changes / Reject.
- Approvals are bound to the plan's SHA-256: an edited plan goes back to pending.
- Risk checklist: files and existence, migrations, deletes/renames, dependency changes, CI/infra, secrets, tests, vague or long plans.
- Overlap warning when open plans touch the same files.
- Blocking gate for Claude Code (`ExitPlanMode` HTTP hook) on `127.0.0.1` with a per-session token.
- Opt-in approval record in `.kogentic/approvals.jsonl`.
- "Insert plan-first rule" for agents without a hook.
- "Add .kogentic/ to .gitignore" command.
- `copyGateToken` for Claude Code started outside the integrated terminal.
- `scripts/e2e-claude.sh` to check the gate with the real Claude Code CLI.

### Known gaps

- Blocking gate validated against Claude Code 2.1.300's hook schema and a simulated ExitPlanMode request; live end-to-end run pending.
- Optional, off-by-default "Send to Kogentic" connector (SecretStorage key, no default URL, payload preview and confirm, no redirects).
- Release workflow that attaches the `.vsix` and `SHA256SUMS.txt` to a GitHub Release.

[Unreleased]: https://github.com/kellyadamtan/kogentic-plan-review/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/kellyadamtan/kogentic-plan-review/releases/tag/v0.1.0
