import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { ChecklistResult } from './checklist';
import type { Review } from './review';

export interface ApprovalRecord {
  time: string;
  planId: string;
  planHash: string;
  title: string;
  decision: Review['status'];
  reviewer?: string;
  checklist: { risks: number; items: string[] };
  comments: number;
}

export function approvalRecord(r: Review, title: string, checklist: ChecklistResult, now = new Date()): ApprovalRecord {
  return {
    time: now.toISOString(),
    planId: r.planId,
    planHash: r.planHash,
    title,
    decision: r.status,
    reviewer: r.decidedBy,
    checklist: { risks: checklist.risks, items: checklist.items.filter((i) => i.level === 'risk').map((i) => i.id) },
    comments: r.comments.length,
  };
}

/** Appends one JSON line to <root>/.kogentic/approvals.jsonl. */
export async function appendApproval(root: string, rec: ApprovalRecord): Promise<string> {
  const file = path.join(root, '.kogentic', 'approvals.jsonl');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, JSON.stringify(rec) + '\n', 'utf8');
  return file;
}
