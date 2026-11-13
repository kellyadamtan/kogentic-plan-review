import * as vscode from 'vscode';
import type { LoadError } from '../core/load';
import { STATUS_LABEL } from '../core/reviewHtml';
import type { PlanEntry, PlanRepository } from './planRepository';

type Group = 'pending' | 'approved' | 'rejected' | 'done';
export type Node = { kind: 'group'; group: Group } | { kind: 'plan'; id: string } | { kind: 'error'; error: LoadError };

const GROUPS: { group: Group; label: string }[] = [
  { group: 'pending', label: 'Pending' },
  { group: 'approved', label: 'Approved' },
  { group: 'rejected', label: 'Rejected' },
  { group: 'done', label: 'Done' },
];

export function groupOf(e: PlanEntry): Group {
  const s = e.review.status;
  return s === 'changes_requested' ? 'pending' : s;
}

export class PlanTree implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly repo: PlanRepository) {
    repo.onDidChange(() => this.emitter.fire(undefined));
  }

  getChildren(node?: Node): Node[] {
    if (!node) {
      const errs: Node[] = this.repo.errors().map((error) => ({ kind: 'error', error }));
      return [...errs, ...GROUPS.map(({ group }) => ({ kind: 'group' as const, group }))];
    }
    if (node.kind === 'group') {
      return this.repo.all().filter((e) => groupOf(e) === node.group).map((e) => ({ kind: 'plan' as const, id: e.plan.id }));
    }
    return [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'error') {
      const item = new vscode.TreeItem(`Cannot read ${node.error.path.split(/[\\/]/).pop()}`, vscode.TreeItemCollapsibleState.None);
      item.description = node.error.message;
      item.tooltip = `${node.error.path}\n${node.error.message}`;
      item.iconPath = new vscode.ThemeIcon('error');
      item.contextValue = 'loadError';
      return item;
    }
    if (node.kind === 'group') {
      const count = this.getChildren(node).length;
      const label = GROUPS.find((g) => g.group === node.group)!.label;
      const item = new vscode.TreeItem(`${label} (${count})`, node.group === 'pending' ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
      item.contextValue = 'group';
      item.id = `group:${node.group}`;
      return item;
    }
    const e = this.repo.get(node.id);
    if (!e) return new vscode.TreeItem('(missing plan)');
    const item = new vscode.TreeItem(e.plan.title, vscode.TreeItemCollapsibleState.None);
    const overlaps = this.repo.overlaps(e.plan.id);
    item.id = `plan:${e.plan.id}`;
    item.description = [e.plan.agent, e.review.status === 'changes_requested' ? STATUS_LABEL.changes_requested : undefined, e.checklist.risks ? `${e.checklist.risks} risk${e.checklist.risks === 1 ? '' : 's'}` : undefined, overlaps.length ? 'overlaps' : undefined].filter(Boolean).join(' · ');
    item.tooltip = new vscode.MarkdownString(`**${e.plan.title}**\n\n${e.plan.path}\n\nStatus: ${STATUS_LABEL[e.review.status]}`);
    item.iconPath = new vscode.ThemeIcon(overlaps.length ? 'warning' : e.review.status === 'approved' || e.review.status === 'done' ? 'pass' : e.review.status === 'rejected' ? 'circle-slash' : 'circle-large-outline');
    item.contextValue = 'plan';
    item.command = { command: 'kogenticPlanReview.openPlan', title: 'Open plan review', arguments: [e.plan.id] };
    return item;
  }
}
