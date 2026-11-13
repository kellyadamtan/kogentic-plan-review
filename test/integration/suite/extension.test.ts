import * as assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

interface Api {
  plans(): { plan: { id: string; title: string; path: string; agent: string; files: string[] }; review: { status: string }; checklist: { risks: number } }[];
  loadErrors(): { path: string; message: string }[];
  review(id: string): { status: string; comments: unknown[] } | undefined;
  overlaps(id: string): { otherId: string; otherTitle: string; files: string[] }[];
  refresh(): Promise<void>;
  connectorEnabled(): boolean;
}

const WS = process.env.KPR_WS as string;
const EXT_ID = 'kogentic.kogentic-plan-review';

async function api(): Promise<Api> {
  const ext = vscode.extensions.getExtension<Api>(EXT_ID);
  assert.ok(ext, 'extension is installed');
  return ext.isActive ? ext.exports : await ext.activate();
}

suite('Kogentic Plan Review', () => {
  test('activates and registers its commands', async () => {
    await api();
    const cmds = await vscode.commands.getCommands(true);
    for (const c of ['openPlan', 'refresh', 'approve', 'requestChanges', 'reject', 'markDone', 'ignoreSidecars', 'showOverlaps', 'exportReview', 'signIn', 'signOut', 'sendToKogentic']) {
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
    assert.equal(await vscode.commands.executeCommand('kogenticPlanReview.ignoreSidecars'), 'added');
    const once = readFileSync(gi, 'utf8');
    assert.match(once, /^\.kogentic\/$/m);
    assert.equal(await vscode.commands.executeCommand('kogenticPlanReview.ignoreSidecars'), 'unchanged');
    assert.equal(readFileSync(gi, 'utf8'), once);
  });

  test('connector is off by default and refuses to send', async () => {
    const a = await api();
    assert.equal(a.connectorEnabled(), false);
    assert.equal(vscode.workspace.getConfiguration('kogenticPlanReview').get('kogentic.enabled'), false);
    assert.equal(vscode.workspace.getConfiguration('kogenticPlanReview').get('kogentic.baseUrl'), '');
    assert.equal(await vscode.commands.executeCommand('kogenticPlanReview.sendToKogentic'), 'disabled');
  });

  test('refuses to write .gitignore through a symlink', async () => {
    const gi = path.join(WS, '.gitignore');
    const outside = path.join(path.dirname(WS), 'outside-gitignore');
    writeFileSync(outside, 'node_modules/\n');
    rmSync(gi);
    symlinkSync(outside, gi);
    assert.equal(await vscode.commands.executeCommand('kogenticPlanReview.ignoreSidecars'), undefined);
    assert.equal(readFileSync(outside, 'utf8'), 'node_modules/\n');
    rmSync(gi);
  });

  test('exports no gate or agent-facing API, and registers no gate commands', async () => {
    const a = await api();
    assert.deepEqual(Object.keys(a).sort(), ['connectorEnabled', 'loadErrors', 'overlaps', 'plans', 'refresh', 'review']);
    const cmds = (await vscode.commands.getCommands(true)).filter((c) => c.startsWith('kogenticPlanReview.'));
    assert.equal(cmds.some((c) => /gate|token|planfirst/i.test(c)), false);
  });
});
