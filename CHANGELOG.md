# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0]

### Added

- Plans view for Claude Code, Cursor, Copilot and plain `PLAN.md` plans, grouped Pending / Approved / Rejected / Done, with live refresh.
- Review panel with rendered plan, Cursor todos, inline comments (stored in `.kogentic/reviews/`), and Approve / Request changes / Reject as local review marks. Nothing is sent back to the agent.
- Review marks are bound to the plan's SHA-256: an edited plan goes back to pending.
- Risk checklist: files and existence, migrations, deletes/renames, dependency changes, CI/infra, secrets, tests, vague or long plans.
- Overlap warning when open plans touch the same files.
- Opt-in approval record in `.kogentic/approvals.jsonl` (machine-scoped setting).
- "Add .kogentic/ to .gitignore" command.
- "Copy Review as Markdown" to pass feedback to an agent or a PR.
- Optional, off-by-default "Send to Kogentic" connector (SecretStorage key, no default URL, payload preview and confirm, no redirects).
- Release workflow that attaches the `.vsix` and `SHA256SUMS.txt` to a GitHub Release, with release notes from `.github/release-notes/`. It builds in a read-only job with install scripts disabled; the job that creates the Release runs no npm.

### Security

- Writes to `.kogentic/reviews/`, `.kogentic/approvals.jsonl` and `.gitignore` refuse symbolic links and paths outside the workspace.
- `recordApprovals`, `kogentic.enabled` and `kogentic.baseUrl` are machine-scoped: a workspace cannot change them.
- No listening sockets and no network calls except the opt-in connector, enforced by a bundle-wide test.

[Unreleased]: https://github.com/kellyadamtan/kogentic-plan-review/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/kellyadamtan/kogentic-plan-review/releases/tag/v0.1.0
