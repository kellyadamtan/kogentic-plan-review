#!/usr/bin/env bash
# End-to-end check of the Claude Code gate with the real `claude` CLI.
# Needs a logged-in Claude Code (claude auth login) and calls the Anthropic API.
# Holds no secrets; the gate token stays in a 0600 file in a temp dir.
#
#   scripts/e2e-claude.sh approve|reject|down
set -euo pipefail
mode="${1:-}"
case "$mode" in approve|reject|down) ;; *) echo "usage: $0 approve|reject|down" >&2; exit 2 ;; esac

repo="$(cd "$(dirname "$0")/.." && pwd)"
port="${KPR_E2E_PORT:-4830}"
claude --version
if ! claude auth status 2>/dev/null | grep -q '"loggedIn": true'; then
  echo "claude is not logged in (run: claude auth login). Stopping." >&2
  exit 3
fi

work="$(mktemp -d "${TMPDIR:-/tmp}/kpr-e2e-XXXXXX")"
chmod 700 "$work"
trap '[[ -n "${gate_pid:-}" ]] && kill "$gate_pid" 2>/dev/null; echo "logs kept in $work"' EXIT

# Throwaway git repo with exactly the hook entry the extension writes.
mkdir -p "$work/repo/.claude"
git -C "$work/repo" init -q
npx --prefix "$repo" esbuild "$repo/src/gate/server.ts" "$repo/src/gate/hookConfig.ts" --bundle --platform=node --format=cjs --outdir="$work/bundle" --log-level=warning
node -e "const h=require('$work/bundle/hookConfig.js');require('fs').writeFileSync('$work/repo/.claude/settings.local.json',h.stringifySettings(h.addGate({},$port,3600)))"

if [[ "$mode" != down ]]; then
  node "$repo/scripts/e2e-gate-runner.mjs" "$work/bundle/server.js" "$port" "$mode" "$work" &
  gate_pid=$!
  for _ in $(seq 50); do [[ -s "$work/token" ]] && break; sleep 0.1; done
  KOGENTIC_GATE_TOKEN="$(cat "$work/token")"
else
  # Gate not running: with onFailure "block", Claude must stay in plan mode.
  KOGENTIC_GATE_TOKEN="not-running"
fi
export KOGENTIC_GATE_TOKEN

cd "$work/repo"
set +e
claude -p --permission-mode plan --permission-prompts none --output-format stream-json --verbose \
  "Make a one-step plan to create hello.txt containing 'hi'. When the plan is ready, call ExitPlanMode. If plan approval is granted, create the file." \
  > "$work/claude.jsonl" 2> "$work/claude.stderr"
echo "claude exit: $?"
set -e
unset KOGENTIC_GATE_TOKEN

echo "--- gate log (token redacted)"; cat "$work/gate.log" 2>/dev/null || echo "(no gate log)"
echo "--- ExitPlanMode tool results"
grep -o '"tool_use_id"[^}]*' "$work/claude.jsonl" | head -5 || true
grep -i -E 'hook|plan mode|ExitPlanMode' "$work/claude.stderr" | head -10 || true
if [[ -f "$work/repo/hello.txt" ]]; then echo "hello.txt created (left plan mode)"; else echo "hello.txt not created"; fi
