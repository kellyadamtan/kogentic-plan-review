# Good first issues

Small, self-contained tasks for new contributors. Comment on a matching issue (or open a discussion)
before starting so work isn't duplicated. Each item lists where to look.

1. **Render Cursor todo `error` status.** Cursor todos can be `error`; give them a distinct style in the
   review panel. `src/core/reviewHtml.ts`, `media/review.css`.
2. **"Copy review as markdown" button polish.** The button exists; add the plan path and a link to the
   plan file to the exported markdown. `reviewMarkdown()` in `src/core/reviewHtml.ts`.
3. **More infrastructure patterns in the checklist.** Add Pulumi, Ansible, Nomad and Serverless files to
   the CI/infra item, with tests. `src/core/checklist.ts`.
4. **Keyboard shortcut for Approve.** Contribute a keybinding active when the review panel is focused. `package.json`.
5. **Light / dark / high-contrast check.** Review `media/review.css` in all built-in themes and fix
   contrast problems (brand accent `#c6613f`).
6. **Better parsing of Claude Code "Files to modify" sections.** Handle tables and nested lists.
   `extractFiles()` in `src/core/plan.ts`, tests in `test/unit/plan.test.ts`.
7. **Empty-state walkthrough.** When no plans are found, show a welcome view explaining where plans come
   from and how to enable the gate. `viewsWelcome` in `package.json`.

## Larger items planned for v0.2

- A Copilot language-model tool so Copilot agent mode can ask for approval (a hard gate for Copilot).
- A gate for Cursor through Cursor hooks.
- Publishing to the VS Code Marketplace and Open VSX (needs a publisher account; not part of v0.1).
- Polling a team decision from Kogentic (`GET /v1/plans/{id}/decision`).
