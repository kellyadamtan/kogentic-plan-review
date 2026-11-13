# Kogentic Plan Review

<img src="media/icon.png" alt="Kogentic" width="96" align="right">

Review, comment on and approve a coding agent's plan **before** it changes your code. One panel for
Claude Code plans, Cursor `*.plan.md` plans, Copilot plans and a plain `PLAN.md`.

- **Plans view** in the activity bar, grouped Pending / Approved / Rejected / Done, with live refresh.
- **Review panel**: the rendered plan, Cursor todos with their status, inline comments on any heading,
  paragraph or list item, and **Approve**, **Request changes** and **Reject** buttons.
- **Risk checklist**: files the plan names (and whether they exist), database migrations,
  deletes and renames, dependency changes, CI and infrastructure files, secrets and `.env`, whether tests
  are mentioned, and vague or very long plans.
- **Overlap warning** when two open plans touch the same files, before two agents collide in a merge.
- **A real blocking gate for Claude Code**: Claude waits in plan mode until you approve here.
- **Approval record** (opt-in): every decision appended to `.kogentic/approvals.jsonl`, which you can commit.
- Works in VS Code, Cursor, Windsurf and VSCodium (anything that installs a `.vsix`).

No account, no telemetry, no network calls. The optional "Send to Kogentic" connector is off unless you turn it on.

## Install

v0.1 is distributed **only as a `.vsix` on [GitHub Releases](https://github.com/kellyadamtan/kogentic-plan-review/releases)**.
It is not on the VS Code Marketplace or Open VSX.

1. Download `kogentic-plan-review-0.1.0.vsix` and `SHA256SUMS.txt` from the release.
2. Verify the checksum:

   ```sh
   # Linux
   sha256sum -c SHA256SUMS.txt
   # macOS
   shasum -a 256 -c SHA256SUMS.txt
   ```

   ```powershell
   # Windows (PowerShell): compare with the hash in SHA256SUMS.txt
   (Get-FileHash .\kogentic-plan-review-0.1.0.vsix -Algorithm SHA256).Hash.ToLower()
   ```

   The release also carries a GitHub artifact attestation. With the GitHub CLI you can check that the
   file was built by this repository's release workflow:

   ```sh
   gh attestation verify kogentic-plan-review-0.1.0.vsix --repo kellyadamtan/kogentic-plan-review
   ```

3. Install it:

   ```sh
   code --install-extension kogentic-plan-review-0.1.0.vsix
   # Cursor:   cursor --install-extension kogentic-plan-review-0.1.0.vsix
   # VSCodium: codium --install-extension kogentic-plan-review-0.1.0.vsix
   ```

   Or use **Extensions: Install from VSIX…** in the command palette.

## Usage

Open a folder. The **Plans** icon in the activity bar lists plans found in:

| Source | Where |
|---|---|
| Plain plans | `PLAN.md`, `plans/**/*.md`, `docs/plans/**/*.md` (setting `kogenticPlanReview.planGlobs`) |
| Cursor | `.cursor/plans/**/*.plan.md` and `~/.cursor/plans/*.plan.md` |
| Claude Code | `~/.claude/plans/*.md` and the project's `plansDirectory` from `.claude/settings.json` |
| Copilot | plans under `.github/plans/`, or any plan file you open |

Set `kogenticPlanReview.includeGlobalPlans` to `false` to hide the plans in your home folder.

Click a plan to open the review panel. Click any heading, paragraph or list item to comment on it.
Comments live in a sidecar file, `.kogentic/reviews/<plan-id>.json`, so the plan file itself is never
modified. Then:

- **Approve**: the plan is approved for this exact text. If the plan file changes, the approval is reset to pending.
- **Request changes**: your note and all comments are combined into feedback for the agent.
- **Reject**: the plan is closed. You can reopen it later.

The same actions are on a CodeLens at the top of plan files, and in the Plans view's context menu.
A status-bar item shows how many plans are waiting.

If a plan file can't be read (for example, permissions), the Plans view shows an error entry for it and a warning appears; it is never dropped silently.

Other commands (all under **Kogentic:** in the command palette):

- **Show Overlapping Plans**: open plans that touch the same files.
- **Copy Review as Markdown**: a summary for a PR description or chat.
- **Add .kogentic/ to .gitignore**: see [Files written to your repo](#files-written-to-your-repo-kogentic).
- **Insert Plan-First Rule**: adds a rule to `AGENTS.md` or `.clinerules` telling agents without a hook
  (Cline, Roo and others) to write `PLAN.md` and wait for approval. This is a soft gate: the agent is asked, not forced.

Settings: `planGlobs`, `includeGlobalPlans`, `recordApprovals` (default off), `gate.port` (default 4815),
`gate.timeoutSeconds` (default 3600), `kogentic.enabled` (default **off**), `kogentic.baseUrl` (no default).

## Claude Code blocking gate

> **Requires Claude Code v2.1.295 or later** (`claude --version`). The hook uses `onFailure: "block"`,
> which older versions don't support; on those, Claude Code would carry on if the gate were down.
> The exact hook entry below was checked with Claude Code 2.1.300, whose settings validation accepts it.
>
> Blocking gate validated against Claude Code 2.1.300's hook schema and a simulated ExitPlanMode request; live end-to-end run pending.

Run **Kogentic: Enable Blocking Gate for Claude Code**. The extension shows the change to
`.claude/settings.local.json` as a diff and writes it only after you confirm:

```json
{
  "hooks": {
    "PermissionRequest": [
      {
        "matcher": "ExitPlanMode",
        "hooks": [
          {
            "type": "http",
            "url": "http://127.0.0.1:4815/claude/exit-plan",
            "headers": { "x-kogentic-gate-token": "$KOGENTIC_GATE_TOKEN" },
            "allowedEnvVars": ["KOGENTIC_GATE_TOKEN"],
            "timeout": 3600,
            "onFailure": "block"
          }
        ]
      }
    ]
  }
}
```

When Claude Code finishes a plan and calls `ExitPlanMode`, the hook posts the plan to the extension.
The request is held while the review panel opens. **Approve** answers "allow"; **Request changes** or
**Reject** answers "deny" with your comments as the reason, so Claude revises the plan. If nobody decides
within the timeout, the answer is "deny". Because of `onFailure: "block"`, Claude also stays in plan mode
if VS Code is closed or the gate is not running.

**Kogentic: Disable Blocking Gate for Claude Code** removes exactly that hook entry and stops the server.

### The gate token

- The token is **per session**: a new random token every time VS Code starts the gate (each window
  start, or after Enable). It is never saved, so it stops working when VS Code closes.
- **Claude Code in VS Code's integrated terminal** gets it automatically as `KOGENTIC_GATE_TOKEN`.
  Terminals that were already open when the gate started don't have it yet; open a new terminal
  (VS Code shows a "relaunch" hint on stale terminals).
- **Claude Code started anywhere else** (an external terminal, tmux, or an editor integration that
  doesn't use the integrated terminal): run **Kogentic: Copy Claude Code Gate Token** and set it in
  that shell before starting Claude, for example `export KOGENTIC_GATE_TOKEN=<paste>`. Repeat after
  each VS Code restart. Don't put the token in a file that gets committed.
- Without the right token every plan is refused (401), and because of `onFailure: "block"` Claude
  stays in plan mode. That's the safe failure: fix the token rather than removing the hook.

### Security model of the gate

- **Loopback only.** The server binds to `127.0.0.1` and nothing else. The code refuses any other bind
  address (including `0.0.0.0`, `::` and `localhost`), and tests check that the port is not reachable
  from a non-loopback interface. Connections from non-loopback addresses are rejected as a second line of defence.
- **Per-session token.** Each time VS Code starts the gate it generates a new random 256-bit token.
  Every request must carry it in the `x-kogentic-gate-token` header; it is compared in constant time.
  Requests without the right token get `401` and never reach the review.
- **The token is never written to disk.** The settings file contains only `$KOGENTIC_GATE_TOKEN`. VS Code
  passes the value to terminals in this window through an environment variable that is not persisted.
  See "The gate token" below.
- **Browser protection.** Requests with an `Origin` header are refused and no CORS headers are ever
  sent, so a web page cannot drive the gate. The `Host` header must be `127.0.0.1:<port>` or
  `localhost:<port>`, which blocks DNS-rebinding attacks.
- **Narrow surface.** Only `POST /claude/exit-plan` with a JSON body up to 1 MiB is accepted.
- **Fail closed.** Timeouts, errors and VS Code shutting down all answer "deny".

What the gate does **not** protect against: other software running as your user on the same machine can
read your environment and settings. Treat it as a review tool for your own agent sessions, not a sandbox.

## Files written to your repo (`.kogentic/`)

The extension never edits plan files. It writes its own data under `.kogentic/` in the first workspace folder:

| File | When | Contents |
|---|---|---|
| `.kogentic/reviews/<plan-id>.json` | When you comment on or decide a plan | Status, the plan hash the decision applies to, comments (line, excerpt, text), who decided and when |
| `.kogentic/approvals.jsonl` | Only with `recordApprovals` on | One line per Approve, see below |

The plan id is derived from the plan's path, so a review follows its file. Both are **meant to be
committed** if you want reviews and an audit trail shared with your team. If you'd rather keep them
local, run **Kogentic: Add .kogentic/ to .gitignore** (it asks first and does nothing if the entry is
already there), or add `.kogentic/` to `.gitignore` yourself. With no folder open, reviews go to the
extension's own storage instead.

Plans in your home folder (`~/.claude/plans`, `~/.cursor/plans`) are reviewed the same way; their
sidecars also go to the open workspace's `.kogentic/reviews/`.

## Approval record

With `kogenticPlanReview.recordApprovals` on, each Approve appends one JSON line to
`.kogentic/approvals.jsonl`: plan hash, plan id, title, decision, reviewer (from `git config user.name`),
time, checklist risk ids and comment count. Commit it if you want an audit trail.

## Privacy

- **No telemetry**, no analytics, no update checks, no network calls of any kind by default.
- The only listening socket is the opt-in gate on `127.0.0.1`.
- The review panel has a strict Content Security Policy: no remote scripts, styles or images.
- A test (`test/unit/offline.test.ts`) checks the whole bundle, dependencies included, and fails if any
  module other than the gate server and the opt-in connector could open a network connection.

### Optional: send a plan to Kogentic

For teams that want approval from another device, the extension can send a plan to a Kogentic workspace.
This is **off by default** and does nothing until you:

1. set `kogenticPlanReview.kogentic.enabled` to `true` and `kogenticPlanReview.kogentic.baseUrl` to
   your Kogentic URL in your **user** settings (a workspace's settings cannot turn it on or change the URL);
2. run **Kogentic: Sign In to Kogentic** and paste an API key. It is stored in VS Code SecretStorage
   (your OS keychain), never in settings files;
3. run **Kogentic: Send Plan to Kogentic**. The exact JSON to be sent opens in an editor and nothing
   is sent unless you click **Send**.

There is no default URL. `https://` is required; `http://` is accepted only for `localhost`/`127.0.0.1`
(for local testing). Redirects are never followed, so the key and the plan can only go to the URL you
configured. See [docs/connector.md](docs/connector.md) for the payload. The Kogentic API is not public yet.

## Known gaps

- Blocking gate validated against Claude Code 2.1.300's hook schema and a simulated ExitPlanMode request; live end-to-end run pending. See [scripts/e2e-claude.md](scripts/e2e-claude.md) to run it yourself.
- Copilot plans are reviewed, but there is no hard gate for Copilot yet (planned for v0.2).

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: `npm ci`, `npm test`, `xvfb-run -a npm run test:integration`.

## License

[MIT](LICENSE). Bundled third-party code: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
