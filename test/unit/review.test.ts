import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appendApproval, approvalRecord } from '../../src/core/approvals';
import { addComment, decide, deleteComment, feedbackText, isOpen, newReview, reconcile, ReviewStore, Status, STATUSES, TransitionError, TRANSITIONS } from '../../src/core/review';

const ID = 'abcdef0123456789';
const fresh = () => newReview(ID, '/r/PLAN.md', 'h1');

describe('review state', () => {
  it('starts pending and open', () => {
    const r = fresh();
    expect(r.status).toBe('pending');
    expect(isOpen(r)).toBe(true);
  });
  it('approves and rejects from pending', () => {
    const a = decide(fresh(), 'approved', { planHash: 'h1', by: 'me', now: new Date(0) });
    expect(a.status).toBe('approved');
    expect(a.decidedBy).toBe('me');
    expect(a.decidedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(isOpen(a)).toBe(false);
    const r = decide(fresh(), 'rejected', { planHash: 'h1', reason: 'no' });
    expect(r.status).toBe('rejected');
    expect(r.reason).toBe('no');
    expect(isOpen(r)).toBe(false);
    expect(isOpen(decide(fresh(), 'changes_requested', { planHash: 'h1' }))).toBe(true);
  });
  it('enforces the transition table exactly', () => {
    const at = (s: Status) => ({ ...fresh(), status: s });
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        const ok = TRANSITIONS[from].includes(to);
        if (ok) expect(decide(at(from), to, { planHash: 'h1' }).status, `${from}->${to}`).toBe(to);
        else expect(() => decide(at(from), to, { planHash: 'h1' }), `${from}->${to}`).toThrow(TransitionError);
      }
    }
    expect(TRANSITIONS.done).toEqual([]);
    expect(TRANSITIONS.pending).toEqual(['approved', 'changes_requested', 'rejected']);
    expect(TRANSITIONS.approved).toEqual(['done', 'pending']);
    expect(TRANSITIONS.rejected).toEqual(['pending']);
  });
  it('refuses a decision on a stale hash', () => {
    expect(() => decide(fresh(), 'approved', { planHash: 'other' })).toThrow(/changed/);
  });
  it('resets decisions when the plan changes, but keeps done', () => {
    const a = decide(fresh(), 'approved', { planHash: 'h1', by: 'me' });
    const r = reconcile(a, 'h2');
    expect(r.status).toBe('pending');
    expect(r.planHash).toBe('h2');
    expect(r.decidedBy).toBeUndefined();
    expect(reconcile(a, 'h1')).toBe(a);
    for (const s of ['rejected', 'changes_requested'] as Status[]) expect(reconcile({ ...a, status: s }, 'h2').status).toBe('pending');
    const d = reconcile({ ...a, status: 'done' }, 'h2');
    expect(d.status).toBe('done');
    expect(d.decidedBy).toBe('me');
  });
  it('adds and removes comments and builds feedback', () => {
    let r = addComment(fresh(), 5, 'line five', ' fix this ');
    r = addComment(r, 2, '', 'and this');
    expect(r.comments.map((c) => c.text)).toEqual(['fix this', 'and this']);
    expect(() => addComment(r, 1, '', '   ')).toThrow();
    expect(addComment(fresh(), 0.4, '', 'x').comments[0].line).toBe(1);
    r = { ...r, reason: 'Please revise.' };
    expect(feedbackText(r, 'Changes requested:')).toBe('Changes requested:\nPlease revise.\n- Line 2: and this\n- Line 5 ("line five"): fix this');
    expect(deleteComment(r, r.comments[0].id).comments).toHaveLength(1);
  });
});

describe('review store', () => {
  it('round-trips and reconciles against the current hash', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kpr-'));
    const s = new ReviewStore(dir);
    const r = decide(await s.load(ID, '/r/PLAN.md', 'h1'), 'approved', { planHash: 'h1' });
    await s.save(r);
    expect(JSON.parse(readFileSync(join(dir, `${ID}.json`), 'utf8')).status).toBe('approved');
    expect((await s.load(ID, '/r/PLAN.md', 'h1')).status).toBe('approved');
    expect((await s.load(ID, '/r/PLAN.md', 'h2')).status).toBe('pending');
  });
  it('ignores corrupt files and rejects bad ids', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kpr-'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${ID}.json`), '{"version":1,"planId":"abcdef0123456789","planHash":"h","status":"bogus","comments":[]}');
    expect((await new ReviewStore(dir).load(ID, '/p', 'h')).status).toBe('pending');
    expect(() => new ReviewStore(dir).file('../etc/passwd')).toThrow();
  });
  it('appends approval records as JSON lines', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kpr-'));
    const r = decide(fresh(), 'approved', { planHash: 'h1', by: 'Ada' });
    const cl = { risks: 1, items: [{ id: 'tests', label: 'Tests', level: 'risk' as const, detail: '' }, { id: 'files', label: 'F', level: 'ok' as const, detail: '' }] };
    const f = await appendApproval(dir, approvalRecord(r, 'Plan', cl, new Date(0)));
    await appendApproval(dir, approvalRecord(r, 'Plan', cl, new Date(0)));
    const lines = readFileSync(f, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({ time: '1970-01-01T00:00:00.000Z', planId: ID, planHash: 'h1', title: 'Plan', decision: 'approved', reviewer: 'Ada', checklist: { risks: 1, items: ['tests'] }, comments: 0 });
  });
});
