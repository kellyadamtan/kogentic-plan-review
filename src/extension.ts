import * as path from 'node:path';
import * as vscode from 'vscode';
import { appendApproval, approvalRecord } from './core/approvals';
import { safeRead, safeWrite } from './core/safeFs';
import { withSidecarIgnore } from './core/gitignore';
import { loadErrorSummary } from './core/load';
import { ReviewStore, type Review, type Status } from './core/review';
import { reviewMarkdown } from './core/reviewHtml';
import { cfg } from './vscode/config';
import { isConnectorOn, sendToKogentic, signIn, signOut, type SendOutcome } from './vscode/connectorCommands';
import { reviewerName } from './vscode/git';
import { PlanRepository, type PlanEntry } from './vscode/planRepository';
import { ReviewPanels, type DecideAction } from './vscode/reviewPanel';
import { PlanTree, type Node } from './vscode/tree';

/** Returned from activate(); used by the integration tests. */
export interface ExtensionApi {
  plans(): PlanEntry[];
  loadErrors(): { path: string; message: string }[];
  review(id: string): Review | undefined;
  overlaps(id: string): { otherId: string; otherTitle: string; files: string[] }[];
  refresh(): Promise<void>;
  connectorEnabled(): boolean;
}

/** Test-only switches: needs both the test runner's extension mode and an explicit env var. */
export function isTestRun(ctx: vscode.ExtensionContext): boolean {
  return ctx.extensionMode === vscode.ExtensionMode.Test && process.env.KOGENTIC_PLAN_REVIEW_TEST === '1';
}

const ACTION_STATUS: Record<DecideAction, Status> = {
  approve: 'approved',
  requestChanges: 'changes_requested',
  reject: 'rejected',
  markDone: 'done',
  reopen: 'pending',
};

function rootDir(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export async function activate(ctx: vscode.ExtensionContext): Promise<ExtensionApi> {
  const root = rootDir();
  const store = root ? new ReviewStore(path.join(root, '.kogentic', 'reviews'), root) : new ReviewStore(path.join(ctx.globalStorageUri.fsPath, 'reviews'), ctx.globalStorageUri.fsPath);
  const repo = new PlanRepository(store, () => reviewerName(root));
  /**
   * Records a review mark locally (panel status and the .kogentic/ sidecar).
   * Nothing is sent to any agent.
   */
  async function decide(id: string, action: DecideAction, reason?: string): Promise<void> {
    const status = ACTION_STATUS[action];
    const e = await repo.decide(id, status, reason);
    if (status === 'approved' && root && cfg().get<boolean>('recordApprovals', false)) {
      await appendApproval(root, approvalRecord(e.review, e.plan.title, e.checklist));
    }
  }

  async function exportReview(id: string): Promise<void> {
    const e = repo.get(id);
    if (!e) return;
    await vscode.env.clipboard.writeText(reviewMarkdown({ plan: e.plan, review: e.review, checklist: e.checklist, overlaps: repo.overlaps(id) }));
    void vscode.window.showInformationMessage('Review copied to the clipboard as markdown.');
  }

  const panels = new ReviewPanels(ctx.extensionUri, repo, {
    decide,
    exportReview,
    send: async (id) => void (await sendToKogentic(ctx.secrets, repo, id)),
    connectorEnabled: isConnectorOn,
  });

  const tree = new PlanTree(repo);
  const view = vscode.window.createTreeView('kogenticPlanReview.plans', { treeDataProvider: tree, showCollapseAll: true });

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = 'kogenticPlanReview.plans.focus';
  const lensEmitter = new vscode.EventEmitter<void>();
  let lastErrorSummary: string | undefined;
  repo.onDidChange(() => {
    const n = repo.pendingCount();
    status.text = `$(checklist) ${n}`;
    status.tooltip = `Kogentic Plan Review: ${n} plan${n === 1 ? '' : 's'} waiting for review`;
    if (n > 0) status.show();
    else status.hide();
    view.badge = n ? { value: n, tooltip: `${n} pending` } : undefined;
    lensEmitter.fire();
    const summary = loadErrorSummary(repo.errors());
    if (summary && summary !== lastErrorSummary) void vscode.window.showWarningMessage(summary);
    lastErrorSummary = summary;
  });

  /** Resolves a command argument (id, tree node, URI) or asks. */
  async function pick(arg?: unknown, filter?: (e: PlanEntry) => boolean): Promise<string | undefined> {
    if (typeof arg === 'string' && repo.get(arg)) return arg;
    if (arg && typeof arg === 'object') {
      const n = arg as Node;
      if (n.kind === 'plan') return n.id;
      if (arg instanceof vscode.Uri) return repo.byFsPath(arg.fsPath)?.plan.id;
    }
    const active = panels.activeId();
    if (active) return active;
    const doc = vscode.window.activeTextEditor?.document;
    const fromEditor = doc ? repo.byFsPath(doc.uri.fsPath) : undefined;
    if (fromEditor) return fromEditor.plan.id;
    const items = repo.all().filter(filter ?? (() => true)).map((e) => ({ label: e.plan.title, description: `${e.plan.agent} · ${e.review.status}`, detail: e.plan.path, id: e.plan.id }));
    if (!items.length) {
      void vscode.window.showInformationMessage('No plans found. Plans are read from PLAN.md, plans/, .cursor/plans/ and ~/.claude/plans.');
      return undefined;
    }
    return (await vscode.window.showQuickPick(items, { title: 'Pick a plan' }))?.id;
  }

  const run = (f: (...a: unknown[]) => Promise<unknown>) => async (...a: unknown[]) => {
    try {
      return await f(...a);
    } catch (e) {
      void vscode.window.showErrorMessage((e as Error).message);
      return undefined;
    }
  };

  const decideCmd = (action: DecideAction) =>
    run(async (arg) => {
      const id = await pick(arg);
      if (!id) return undefined;
      await decide(id, action);
      return repo.get(id)?.review.status;
    });

  const reg = (name: string, f: (...a: unknown[]) => unknown) => ctx.subscriptions.push(vscode.commands.registerCommand(`kogenticPlanReview.${name}`, f));

  reg('openPlan', run(async (arg) => {
    const id = await pick(arg);
    if (id) panels.show(id);
    return id;
  }));
  reg('refresh', run(() => repo.refresh()));
  reg('approve', decideCmd('approve'));
  reg('requestChanges', decideCmd('requestChanges'));
  reg('reject', decideCmd('reject'));
  reg('markDone', decideCmd('markDone'));
  reg('ignoreSidecars', run(async () => {
    if (!root) throw new Error('Open a folder first.');
    const file = path.join(root, '.gitignore');
    const next = withSidecarIgnore(await safeRead(root, file));
    if (next === undefined) {
      void vscode.window.showInformationMessage('.kogentic/ is already in .gitignore.');
      return 'unchanged';
    }
    // Only the integration tests can skip the dialog (see isTestRun).
    const preConfirmed = isTestRun(ctx) && process.env.KOGENTIC_PLAN_REVIEW_TEST_CONFIRM === '1';
    if (!preConfirmed) {
      const ok = await vscode.window.showWarningMessage(
        'Add .kogentic/ to .gitignore? Reviews and the approval record will then stay out of git. They are meant to be committed if you want a shared audit trail.',
        { modal: true },
        'Add to .gitignore',
      );
      if (ok !== 'Add to .gitignore') return 'cancelled';
    }
    await safeWrite(root, file, next);
    return 'added';
  }));
  reg('showOverlaps', run(async () => {
    const items = repo.all().flatMap((e) => repo.overlaps(e.plan.id).map((o) => ({ label: `${e.plan.title} ↔ ${o.otherTitle}`, detail: o.files.join(', '), id: e.plan.id })));
    if (!items.length) {
      void vscode.window.showInformationMessage('No open plans touch the same files.');
      return 0;
    }
    const c = await vscode.window.showQuickPick(items, { title: 'Plans that touch the same files' });
    if (c) panels.show(c.id);
    return items.length;
  }));
  reg('exportReview', run(async (arg) => {
    const id = await pick(arg);
    if (id) await exportReview(id);
  }));
  reg('signIn', run(() => signIn(ctx.secrets)));
  reg('signOut', run(() => signOut(ctx.secrets)));
  reg('sendToKogentic', run(async (arg): Promise<SendOutcome | undefined> => {
    if (!isConnectorOn()) return sendToKogentic(ctx.secrets, repo, '');
    const id = await pick(arg);
    return id ? sendToKogentic(ctx.secrets, repo, id) : undefined;
  }));

  ctx.subscriptions.push(
    repo,
    panels,
    view,
    status,
    lensEmitter,
    vscode.languages.registerCodeLensProvider({ language: 'markdown' }, {
      onDidChangeCodeLenses: lensEmitter.event,
      provideCodeLenses(doc) {
        const e = repo.byFsPath(doc.uri.fsPath);
        if (!e) return [];
        const r = new vscode.Range(0, 0, 0, 0);
        const lens = (title: string, command: string) => new vscode.CodeLens(r, { title, command: `kogenticPlanReview.${command}`, arguments: [e.plan.id] });
        const lenses = [lens(`$(checklist) Review plan (${e.review.status.replace('_', ' ')})`, 'openPlan')];
        if (e.review.status === 'pending' || e.review.status === 'changes_requested') {
          lenses.push(lens('Approve', 'approve'), lens('Request changes', 'requestChanges'), lens('Reject', 'reject'));
        }
        return lenses;
      },
    }),
    vscode.workspace.onDidChangeConfiguration((ev) => {
      if (ev.affectsConfiguration('kogenticPlanReview')) repo.scheduleRefresh();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => repo.scheduleRefresh()),
  );

  await repo.refresh();

  return {
    plans: () => repo.all(),
    loadErrors: () => repo.errors(),
    review: (id) => repo.get(id)?.review,
    overlaps: (id) => repo.overlaps(id),
    refresh: () => repo.refresh(),
    connectorEnabled: isConnectorOn,
  };
}

export function deactivate(): void {
  // Everything is disposed through ctx.subscriptions.
}
