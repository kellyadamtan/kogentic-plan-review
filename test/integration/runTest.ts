import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

/** Exact VS Code build used for the integration tests (kept in step with CI). */
export const VSCODE_VERSION = '1.145.3';

async function main(): Promise<void> {
  const repo = path.resolve(__dirname, '../..');
  const work = mkdtempSync(path.join(tmpdir(), 'kpr-it-'));
  const ws = path.join(work, 'workspace');
  cpSync(path.join(repo, 'test/integration/fixture'), ws, { recursive: true });
  mkdirSync(path.join(ws, '.vscode'), { recursive: true });
  writeFileSync(
    path.join(ws, '.vscode', 'settings.json'),
    JSON.stringify({ 'kogenticPlanReview.includeGlobalPlans': false }, null, 2),
  );
  // A plan file nobody can read: it must show up as an error, not vanish.
  const locked = path.join(ws, 'plans', 'locked.md');
  writeFileSync(locked, '# Locked plan\n');
  chmodSync(locked, 0o000);
  const canTestUnreadable = process.platform !== 'win32' && process.getuid?.() !== 0;
  if (!canTestUnreadable) rmSync(locked);

  let code: number;
  try {
    code = await runTests({
      version: VSCODE_VERSION,
      cachePath: path.join(repo, '.vscode-test'),
      extensionDevelopmentPath: repo,
      extensionTestsPath: path.join(__dirname, 'suite', 'index.js'),
      // KOGENTIC_PLAN_REVIEW_TEST* only take effect in the test runner's extension mode (see isTestRun).
      extensionTestsEnv: { KPR_WS: ws, KPR_UNREADABLE: canTestUnreadable ? '1' : '0', KOGENTIC_PLAN_REVIEW_TEST: '1', KOGENTIC_PLAN_REVIEW_TEST_CONFIRM: '1' },
      launchArgs: [ws, '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-telemetry', '--user-data-dir', path.join(work, 'user-data')],
    });
  } finally {
    try {
      chmodSync(locked, 0o600);
    } catch {
      // already removed
    }
    rmSync(work, { recursive: true, force: true });
  }
  process.exit(code);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
