# End-to-end test with the real Claude Code CLI

`scripts/e2e-claude.sh` runs the gate outside VS Code with the same hook entry the extension writes,
then asks `claude` (in plan mode) for a trivial plan so that it calls `ExitPlanMode` and the hook hits
the gate.

```sh
claude --version                 # needs 2.1.295 or later for onFailure
claude auth login                # the test calls the Anthropic API
scripts/e2e-claude.sh approve    # expect: allow, Claude leaves plan mode, hello.txt is created
scripts/e2e-claude.sh reject     # expect: deny with the reason, hello.txt is not created
scripts/e2e-claude.sh down       # gate not running: onFailure "block" keeps Claude in plan mode
```

The script works in a throwaway temp repo, writes the gate token only to a `0600` file in that temp
dir, and logs each hook request and the gate's answer (token redacted) to `gate.log` there. Nothing is
written to this repository.

If `-p` mode in your Claude Code version does not offer `ExitPlanMode`, run the same thing
interactively: start the runner (`node scripts/e2e-gate-runner.mjs …`), export
`KOGENTIC_GATE_TOKEN` from the token file, and run `claude --permission-mode plan` in the temp repo.

## Settings validation without a login

Claude Code validates settings files offline. In the temp repo with the generated
`.claude/settings.local.json`, `claude doctor` reports `Invalid settings` for a bad hook entry (for
example `"onFailure": "bogus"`) and nothing for the entry the extension writes.
