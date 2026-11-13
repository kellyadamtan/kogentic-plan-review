# Contributing

Thanks for helping. Small, focused pull requests are easiest to review.

## Setup (3 commands)

```sh
npm ci
npm test                                   # unit tests (vitest)
xvfb-run -a npm run test:integration       # VS Code integration tests (drop xvfb-run on macOS/Windows)
```

Node 24.22.1 is what CI uses. Press F5 in VS Code to start an Extension Development Host
(run `npm run build` first, or `npm run watch` in a terminal).

Before opening a PR:

```sh
npm run typecheck
npm run lint
npm test
npm run package && node scripts/check-vsix.mjs kogentic-plan-review-*.vsix
```

## Layout

| Path | What |
|---|---|
| `src/core/` | Pure logic, no `vscode` import: plan parser, checklist, overlaps, review state, connector, webview HTML. Unit tested with vitest. |
| `src/vscode/` | VS Code glue: plan discovery, tree, review panel, commands. |
| `media/` | Webview script and styles, icons. |
| `test/unit/` | vitest tests. Local servers in tests use ports 4800-4819. |
| `test/integration/` | `@vscode/test-electron` tests against a fixture workspace. |

Keep `src/core/` free of `vscode` imports so the parser and checklist can be reused elsewhere.

## Adding a checklist item

1. Add the detection to `src/core/checklist.ts` (keep it a cheap heuristic and give the reason in `detail`).
2. Add a positive and a negative case to `test/unit/checklist.test.ts`.
3. Mention it in the README feature list.

## Rules

- No telemetry and no network calls. `test/unit/offline.test.ts` enforces this; if you need an exception, explain why in the PR.
- Reviews stay local: the extension doesn't listen on a port or send anything to a coding agent.
- Workspace writes go through `src/core/safeFs.ts` (no symlinks, nothing outside the folder).
- Pin new GitHub Actions to a full commit SHA.
- Brand colours are `#c6613f` and black.

## Developer Certificate of Origin

Sign off your commits (`git commit -s`) to certify the [DCO](https://developercertificate.org/).

By contributing you agree your work is released under the MIT license.
