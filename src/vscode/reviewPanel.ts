import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { checkPanelMessage } from '../core/panelMessage';
import { renderReviewHtml } from '../core/reviewHtml';
import type { PlanRepository } from './planRepository';

export type DecideAction = 'approve' | 'requestChanges' | 'reject' | 'markDone' | 'reopen';

export interface PanelHost {
  decide(id: string, action: DecideAction, reason?: string): Promise<void>;
  exportReview(id: string): Promise<void>;
  send(id: string): Promise<void>;
  connectorEnabled(): boolean;
}

/** One webview panel per plan. */
export class ReviewPanels implements vscode.Disposable {
  private panels = new Map<string, vscode.WebviewPanel>();

  constructor(private readonly extUri: vscode.Uri, private readonly repo: PlanRepository, private readonly host: PanelHost) {
    repo.onDidChange(() => this.renderAll());
  }

  dispose(): void {
    this.panels.forEach((p) => p.dispose());
  }

  activeId(): string | undefined {
    for (const [id, p] of this.panels) if (p.active) return id;
    return undefined;
  }

  isOpen(id: string): boolean {
    return this.panels.has(id);
  }

  show(id: string, preserveFocus = false): void {
    const e = this.repo.get(id);
    if (!e) throw new Error('This plan is no longer available. Refresh the Plans view.');
    let p = this.panels.get(id);
    if (p) {
      p.reveal(undefined, preserveFocus);
      this.render(id);
      return;
    }
    const media = vscode.Uri.joinPath(this.extUri, 'media');
    p = vscode.window.createWebviewPanel('kogenticPlanReview.review', `Review: ${e.plan.title}`, { viewColumn: vscode.ViewColumn.Active, preserveFocus }, {
      enableScripts: true,
      enableCommandUris: false,
      enableFindWidget: true,
      localResourceRoots: [media],
      retainContextWhenHidden: true,
    });
    p.iconPath = vscode.Uri.joinPath(media, 'icon.png');
    this.panels.set(id, p);
    p.onDidDispose(() => this.panels.delete(id));
    p.webview.onDidReceiveMessage((m: unknown) => void this.onMessage(id, m));
    this.render(id);
  }

  private renderAll(): void {
    for (const id of [...this.panels.keys()]) this.render(id);
  }

  private render(id: string): void {
    const p = this.panels.get(id);
    const e = this.repo.get(id);
    if (!p) return;
    if (!e) {
      p.dispose();
      return;
    }
    const media = vscode.Uri.joinPath(this.extUri, 'media');
    p.title = `Review: ${e.plan.title}`;
    p.webview.html = renderReviewHtml(
      { plan: e.plan, review: e.review, checklist: e.checklist, overlaps: this.repo.overlaps(id), connectorEnabled: this.host.connectorEnabled() },
      {
        nonce: randomBytes(16).toString('base64'),
        cspSource: p.webview.cspSource,
        scriptUri: p.webview.asWebviewUri(vscode.Uri.joinPath(media, 'review.js')).toString(),
        styleUri: p.webview.asWebviewUri(vscode.Uri.joinPath(media, 'review.css')).toString(),
      },
    );
  }

  private async onMessage(id: string, m: unknown): Promise<void> {
    const e = this.repo.get(id);
    if (!e) return;
    try {
      const c = checkPanelMessage(m, e.plan.hash);
      if (!c.ok) {
        if (c.why === 'stale') {
          void vscode.window.showWarningMessage('The plan changed while the review was open. It has been reloaded; please review it again.');
          this.render(id);
        }
        return;
      }
      const cmd = c.cmd;
      switch (cmd.type) {
        case 'decide':
          await this.host.decide(id, cmd.action, cmd.reason);
          break;
        case 'comment':
          await this.repo.comment(id, cmd.line, cmd.excerpt, cmd.text);
          break;
        case 'deleteComment':
          await this.repo.deleteComment(id, cmd.id);
          break;
        case 'openPlan':
          if (this.repo.get(cmd.id)) this.show(cmd.id);
          break;
        case 'export':
          await this.host.exportReview(id);
          break;
        case 'send':
          await this.host.send(id);
          break;
      }
    } catch (err) {
      void vscode.window.showErrorMessage((err as Error).message);
    }
  }
}
