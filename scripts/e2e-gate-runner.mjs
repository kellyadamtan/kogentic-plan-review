// Starts the extension's gate server (bundled from src/gate/server.ts) outside VS Code
// for the end-to-end test with the real Claude Code CLI. See scripts/e2e-claude.md.
//
//   node scripts/e2e-gate-runner.mjs <bundled-server.cjs> <port> <approve|reject> <workdir>
//
// The per-session token is written to <workdir>/token (mode 0600) for the shell to
// export as KOGENTIC_GATE_TOKEN. It is never printed. Each hook request and the
// gate's answer are appended to <workdir>/gate.log as JSON lines, without the token.
import { appendFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const [bundle, portArg, decision, workdir] = process.argv.slice(2);
if (!bundle || !portArg || !['approve', 'reject'].includes(decision) || !workdir) {
  console.error('usage: e2e-gate-runner.mjs <bundle.cjs> <port> <approve|reject> <workdir>');
  process.exit(2);
}
const { GateServer, hookResponse } = createRequire(import.meta.url)(bundle);
const log = (o) => appendFileSync(join(workdir, 'gate.log'), JSON.stringify({ time: new Date().toISOString(), ...o }) + '\n');

const server = new GateServer({
  port: Number(portArg),
  timeoutMs: 120000,
  onPlan: async (req) => {
    const d = decision === 'approve'
      ? { allow: true, reason: 'Approved in Kogentic Plan Review.' }
      : { allow: false, reason: 'The plan was rejected in Kogentic Plan Review.\n- Line 1: e2e test rejection' };
    log({
      request: { headers: { 'x-kogentic-gate-token': '<redacted; matched>' }, hook_event_name: req.hookEvent, session_id: req.sessionId, cwd: req.cwd, tool_input: req.toolInput },
      response: hookResponse(req.hookEvent, d, req.toolInput),
    });
    return d;
  },
});
await server.start();
writeFileSync(join(workdir, 'token'), server.token, { mode: 0o600 });
log({ started: server.url, address: server.address });
const stop = () => server.stop().then(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
