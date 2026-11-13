import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export type Status = 'pending' | 'approved' | 'changes_requested' | 'rejected' | 'done';
export const STATUSES: readonly Status[] = ['pending', 'approved', 'changes_requested', 'rejected', 'done'];

export interface Comment {
  id: string;
  line: number;
  excerpt: string;
  text: string;
  createdAt: string;
}

export interface Review {
  version: 1;
  planId: string;
  planPath: string;
  planHash: string;
  status: Status;
  comments: Comment[];
  decidedAt?: string;
  decidedBy?: string;
  reason?: string;
}

/** Allowed status changes. A decision is always about one exact plan text. */
export const TRANSITIONS: Readonly<Record<Status, readonly Status[]>> = {
  pending: ['approved', 'changes_requested', 'rejected'],
  changes_requested: ['approved', 'changes_requested', 'rejected', 'pending'],
  approved: ['done', 'pending'],
  rejected: ['pending'],
  done: [],
};

export class TransitionError extends Error {}

export function newReview(planId: string, planPath: string, planHash: string): Review {
  return { version: 1, planId, planPath, planHash, status: 'pending', comments: [] };
}

/** Is the plan still waiting for a decision? */
export function isOpen(r: Review): boolean {
  return r.status === 'pending' || r.status === 'changes_requested';
}

/**
 * Brings a stored review in line with the current plan text. If the plan
 * changed after a decision, the decision no longer applies: back to pending.
 */
export function reconcile(r: Review, planHash: string): Review {
  if (r.planHash === planHash) return r;
  const reset = r.status === 'approved' || r.status === 'rejected' || r.status === 'changes_requested';
  return {
    ...r,
    planHash,
    status: reset ? 'pending' : r.status,
    decidedAt: reset ? undefined : r.decidedAt,
    decidedBy: reset ? undefined : r.decidedBy,
    reason: reset ? undefined : r.reason,
  };
}

export interface DecideOptions {
  planHash: string;
  by?: string;
  reason?: string;
  now?: Date;
}

/** Records a decision. Throws TransitionError on an invalid change or a stale plan hash. */
export function decide(r: Review, to: Status, o: DecideOptions): Review {
  if (o.planHash !== r.planHash) {
    throw new TransitionError('The plan changed since it was loaded. Reload it before deciding.');
  }
  if (!TRANSITIONS[r.status].includes(to)) {
    throw new TransitionError(`Cannot change a plan from ${r.status} to ${to}.`);
  }
  return {
    ...r,
    status: to,
    decidedAt: (o.now ?? new Date()).toISOString(),
    decidedBy: o.by,
    reason: o.reason,
  };
}

export function addComment(r: Review, line: number, excerpt: string, text: string, now = new Date()): Review {
  const t = text.trim();
  if (!t) throw new TransitionError('A comment cannot be empty.');
  const c: Comment = { id: randomUUID(), line: Math.max(1, Math.floor(line)), excerpt: excerpt.slice(0, 200), text: t, createdAt: now.toISOString() };
  return { ...r, comments: [...r.comments, c] };
}

export function deleteComment(r: Review, id: string): Review {
  return { ...r, comments: r.comments.filter((c) => c.id !== id) };
}

/** Combined feedback for "Request changes" / "Reject", sent back to the agent. */
export function feedbackText(r: Review, header?: string): string {
  const parts: string[] = [];
  if (header) parts.push(header);
  if (r.reason) parts.push(r.reason);
  for (const c of [...r.comments].sort((a, b) => a.line - b.line)) {
    parts.push(`- Line ${c.line}${c.excerpt ? ` ("${c.excerpt}")` : ''}: ${c.text}`);
  }
  return parts.join('\n');
}

function isReview(v: unknown): v is Review {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return o.version === 1 && typeof o.planId === 'string' && typeof o.planHash === 'string' &&
    typeof o.status === 'string' && (STATUSES as readonly string[]).includes(o.status) && Array.isArray(o.comments);
}

/** Stores reviews as sidecar JSON files, so plan files are never modified. */
export class ReviewStore {
  constructor(private readonly dir: string) {}

  file(planId: string): string {
    if (!/^[a-f0-9]{8,64}$/.test(planId)) throw new Error(`invalid plan id ${planId}`);
    return path.join(this.dir, `${planId}.json`);
  }

  async load(planId: string, planPath: string, planHash: string): Promise<Review> {
    try {
      const v: unknown = JSON.parse(await fs.readFile(this.file(planId), 'utf8'));
      if (isReview(v) && v.planId === planId) return reconcile(v, planHash);
    } catch {
      // missing or unreadable: start fresh
    }
    return newReview(planId, planPath, planHash);
  }

  async save(r: Review): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const tmp = this.file(r.planId) + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(r, null, 2) + '\n', 'utf8');
    await fs.rename(tmp, this.file(r.planId));
  }
}
