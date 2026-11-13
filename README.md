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
- **Approval record** (opt-in): every Approve appended to `.kogentic/approvals.jsonl`, which you can commit.
- Works in VS Code, Cursor, Windsurf and VSCodium (anything that installs a `.vsix`).

Reviews are local: Approve, Request changes and Reject are marks in the panel and in a `.kogentic/`
sidecar file. Nothing is sent back to the agent, and nothing blocks or pauses an agent while it runs.

No account, no telemetry, no network calls. The optional "Send to Kogentic" connector is off unless you turn it on.

Blocking approval gates and team approval workflows are available in the Kogentic platform.

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
| Copilot | Markdown files under `.github/plans/` (in the default `planGlobs`). Copilot doesn't save plans there by itself: save or move the plan there. Files whose name contains `copilot` in any watched location are also labelled Copilot. |

Set `kogenticPlanReview.includeGlobalPlans` to `false` to hide the plans in your home folder.

Click a plan to open the review panel. Click any heading, paragraph or list item to comment on it.
Comments live in a sidecar file, `.kogentic/reviews/<plan-id>.json`, so the plan file itself is never
modified. Then:

- **Approve**: the plan is marked approved for this exact text. If the plan file changes, the mark is reset to pending.
- **Request changes**: the plan is marked as needing changes; your note is saved with the review.
- **Reject**: the plan is marked rejected. You can reopen it later.

These are local review marks only. To pass your feedback to the agent, use **Copy Review as Markdown**
and paste it into the agent's chat.

The same actions are on a CodeLens at the top of plan files, and in the Plans view's context menu.
A status-bar item shows how many plans are waiting.

If a plan file can't be read (for example, permissions), the Plans view shows an error entry for it and a warning appears; it is never dropped silently.

Other commands (all under **Kogentic:** in the command palette):

- **Show Overlapping Plans**: open plans that touch the same files.
- **Copy Review as Markdown**: a summary for a PR description or chat.
- **Add .kogentic/ to .gitignore**: see [Files written to your repo](#files-written-to-your-repo-kogentic).

Settings: `planGlobs`, `includeGlobalPlans`, `recordApprovals` (default off), `kogentic.enabled`
(default **off**), `kogentic.baseUrl` (no default).
`recordApprovals`, `kogentic.enabled` and `kogentic.baseUrl` are machine-scoped: set them in your user
settings; a workspace's `.vscode/settings.json` cannot change them.

**Multi-root workspaces:** plans are found in every folder, but `.kogentic/` sidecars, the approval
record and the `.gitignore` command all use the **first** workspace folder only.

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

**No writes through symlinks.** `.kogentic/reviews/`, `.kogentic/approvals.jsonl` and `.gitignore` are
written only if neither the file nor any folder on the way is a symbolic link and the target stays
inside the workspace folder; otherwise the command stops with an error and writes nothing.

## Approval record

With `kogenticPlanReview.recordApprovals` on, each Approve appends one JSON line to
`.kogentic/approvals.jsonl`: plan hash, plan id, title, decision, reviewer (from `git config user.name`),
time, checklist risk ids and comment count. Commit it if you want an audit trail.

## Privacy

- **No telemetry**, no analytics, no update checks, no network calls of any kind by default.
- The extension opens no listening socket.
- The review panel has a strict Content Security Policy: no remote scripts, styles or images.
- A test (`test/unit/offline.test.ts`) checks the whole bundle, dependencies included, and fails if any
  module other than the opt-in connector could open a network connection, or if anything listens on a port.

### Optional: send a plan to Kogentic

The extension can send a plan to your Kogentic workspace.
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

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: `npm ci`, `npm test`, `xvfb-run -a npm run test:integration`.

## License

[MIT](LICENSE). Bundled third-party code: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
