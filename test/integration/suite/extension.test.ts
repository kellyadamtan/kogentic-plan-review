import * as assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import * as vscode from 'vscode';

interface Api {
  plans(): { plan: { id: string; title: string; path: string; agent: string; files: string[] }; review: { status: string }; checklist: { risks: number } }[];
  loadErrors(): { path: string; message: string }[];
  review(id: string): { status: string; comments: unknown[] } | undefined;
  overlaps(id: string): { otherId: string; otherTitle: string; files: string[] }[];
  refresh(): Promise<void>;
  gate: { info(): { running: boolean; port?: number; address?: string; url?: string; token?: string }; start(): Promise<void>; stop(): Promise<void>; isWaiting(id: string): boolean };
  connectorEnabled(): boolean;
}

const WS = process.env.KPR_WS as string;
const EXT_ID = 'kogentic.kogentic-plan-review';

async function api(): Promise<Api> {
  const ext = vscode.extensions.getExtension<Api>(EXT_ID);
  assert.ok(ext, 'extension is installed');
  return ext.isActive ? ext.exports : await ext.activate();
}

function post(url: string, token: string | undefined, body: unknown): Promise<{ status: number; json: unknown }> {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const headers: Record<string, string> = { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(data)) };
    if (token) headers['x-kogentic-gate-token'] = token;
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, json: b ? JSON.parse(b) : undefined }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

async function until<T>(f: () => T | undefined, ms = 10000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = f();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 100));
  }
}

suite('Kogentic Plan Review', () => {
  test('activates and registers its commands', async () => {
    await api();
    const cmds = await vscode.commands.getCommands(true);
    for (const c of ['openPlan', 'refresh', 'approve', 'requestChanges', 'reject', 'markDone', 'enableClaudeGate', 'disableClaudeGate', 'copyGateToken', 'insertPlanFirstRule', 'ignoreSidecars', 'showOverlaps', 'exportReview', 'signIn', 'signOut', 'sendToKogentic']) {
      assert.ok(cmds.includes(`kogenticPlanReview.${c}`), c);
    }
  });

  test('finds plans from PLAN.md, plans/ and .cursor/plans', async () => {
    const a = await api();
    const titles = a.plans().map((p) => p.plan.title).sort();
    assert.deepEqual(titles, ['Add rate limiting', 'Refactor login', 'Session cleanup']);
    const cursor = a.plans().find((p) => p.plan.title === 'Add rate limiting');
    assert.equal(cursor?.plan.agent, 'cursor');
    assert.ok(a.plans().every((p) => p.review.status === 'pending'));
  });

  test('reports an unreadable plan file instead of skipping it', async function () {
    if (process.env.KPR_UNREADABLE !== '1') this.skip();
    const a = await api();
    const errs = a.loadErrors();
    assert.equal(errs.length, 1);
    assert.match(errs[0].path, /locked\.md$/);
    assert.match(errs[0].message, /EACCES/);
  });

  test('warns about overlapping files', async () => {
    const a = await api();
    const login = a.plans().find((p) => p.plan.title === 'Refactor login')!;
    const session = a.plans().find((p) => p.plan.title === 'Session cleanup')!;
    const rate = a.plans().find((p) => p.plan.title === 'Add rate limiting')!;
    assert.deepEqual(a.overlaps(login.plan.id), [{ otherId: session.plan.id, otherTitle: 'Session cleanup', files: ['src/auth/session.ts'] }]);
    assert.deepEqual(a.overlaps(session.plan.id).map((o) => o.otherId), [login.plan.id]);
    assert.deepEqual(a.overlaps(rate.plan.id), []);
  });

  test('approve writes the review sidecar, and the plan file is untouched', async () => {
    const a = await api();
    const p = a.plans().find((x) => x.plan.title === 'Session cleanup')!;
    const before = readFileSync(p.plan.path, 'utf8');
    const status = await vscode.commands.executeCommand('kogenticPlanReview.approve', p.plan.id);
    assert.equal(status, 'approved');
    const file = path.join(WS, '.kogentic', 'reviews', `${p.plan.id}.json`);
    assert.ok(existsSync(file));
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).status, 'approved');
    assert.equal(readFileSync(p.plan.path, 'utf8'), before);
    assert.equal(a.review(p.plan.id)?.status, 'approved');
    assert.ok(!existsSync(path.join(WS, '.kogentic', 'approvals.jsonl')), 'approvals are opt-in');
  });

  test('reject from pending, then no second decision', async () => {
    const a = await api();
    const p = a.plans().find((x) => x.plan.title === 'Refactor login')!;
    assert.equal(await vscode.commands.executeCommand('kogenticPlanReview.reject', p.plan.id), 'rejected');
    // rejected -> approved is not allowed; the command reports an error and leaves the state alone
    await vscode.commands.executeCommand('kogenticPlanReview.approve', p.plan.id);
    assert.equal(a.review(p.plan.id)?.status, 'rejected');
  });

  test('adds .kogentic/ to .gitignore once', async () => {
    const gi = path.join(WS, '.gitignore');
    assert.equal(await vscode.commands.executeCommand('kogenticPlanReview.ignoreSidecars', { confirmed: true }), 'added');
    const once = readFileSync(gi, 'utf8');
    assert.match(once, /^\.kogentic\/$/m);
    assert.equal(await vscode.commands.executeCommand('kogenticPlanReview.ignoreSidecars', { confirmed: true }), 'unchanged');
    assert.equal(readFileSync(gi, 'utf8'), once);
  });

  test('connector is off by default and refuses to send', async () => {
    const a = await api();
    assert.equal(a.connectorEnabled(), false);
    assert.equal(vscode.workspace.getConfiguration('kogenticPlanReview').get('kogentic.enabled'), false);
    assert.equal(vscode.workspace.getConfiguration('kogenticPlanReview').get('kogentic.baseUrl'), '');
    assert.equal(await vscode.commands.executeCommand('kogenticPlanReview.sendToKogentic'), 'disabled');
  });

  test('gate is off until enabled, then binds 127.0.0.1 and needs the token', async () => {
    const a = await api();
    assert.equal(a.gate.info().running, false);
    await a.gate.start();
    const info = a.gate.info();
    assert.equal(info.running, true);
    assert.equal(info.address, '127.0.0.1');
    assert.equal(info.url, 'http://127.0.0.1:4820/claude/exit-plan');
    assert.match(info.token ?? '', /^[0-9a-f]{64}$/);
    const body = { hook_event_name: 'PermissionRequest', tool_name: 'ExitPlanMode', session_id: 'it', tool_input: { plan: '# Gate plan\n\n1. Edit `src/gate.ts`\n2. Add tests\n' } };
    const noToken = await post(info.url!, undefined, body);
    assert.equal(noToken.status, 401);
    const wrong = await post(info.url!, 'f'.repeat(64), body);
    assert.equal(wrong.status, 401);

    const pending = post(info.url!, info.token, body);
    const entry = await until(() => a.plans().find((p) => p.plan.title === 'Gate plan' && a.gate.isWaiting(p.plan.id)));
    assert.equal(entry.plan.agent, 'claude-code');
    assert.equal(await vscode.commands.executeCommand('kogenticPlanReview.approve', entry.plan.id), 'approved');
    const res = await pending;
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow', updatedInput: body.tool_input } } });
    await a.gate.stop();
    assert.equal(a.gate.info().running, false);
  });
});
