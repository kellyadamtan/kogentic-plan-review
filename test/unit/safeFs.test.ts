import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { appendApproval } from '../../src/core/approvals';
import { ReviewStore, newReview } from '../../src/core/review';
import { safeRead, safeWrite, UnsafePathError } from '../../src/core/safeFs';

function dirs() {
  const base = mkdtempSync(path.join(tmpdir(), 'kpr-safe-'));
  const ws = path.join(base, 'ws');
  const outside = path.join(base, 'outside');
  mkdirSync(ws);
  mkdirSync(outside);
  return { ws, outside };
}

describe('safe writes', () => {
  it('writes and appends inside the workspace', async () => {
    const { ws } = dirs();
    await safeWrite(ws, path.join(ws, 'a', 'b.txt'), 'one\n');
    await safeWrite(ws, path.join(ws, 'a', 'b.txt'), 'two\n', 'append');
    expect(readFileSync(path.join(ws, 'a', 'b.txt'), 'utf8')).toBe('one\ntwo\n');
    expect(await safeRead(ws, path.join(ws, 'missing'))).toBe('');
  });
  it('refuses a file that is a symlink out of the workspace', async () => {
    const { ws, outside } = dirs();
    writeFileSync(path.join(outside, 'victim'), 'keep');
    symlinkSync(path.join(outside, 'victim'), path.join(ws, '.gitignore'));
    await expect(safeRead(ws, path.join(ws, '.gitignore'))).rejects.toThrow(UnsafePathError);
    await expect(safeWrite(ws, path.join(ws, '.gitignore'), 'x')).rejects.toThrow(UnsafePathError);
    expect(readFileSync(path.join(outside, 'victim'), 'utf8')).toBe('keep');
  });
  it('refuses a folder on the way that is a symlink', async () => {
    const { ws, outside } = dirs();
    symlinkSync(outside, path.join(ws, '.claude'));
    await expect(safeWrite(ws, path.join(ws, '.claude', 'settings.local.json'), '{}')).rejects.toThrow(UnsafePathError);
    expect(existsSync(path.join(outside, 'settings.local.json'))).toBe(false);
  });
  it('refuses paths outside the root', async () => {
    const { ws, outside } = dirs();
    await expect(safeWrite(ws, path.join(outside, 'x'), 'x')).rejects.toThrow(UnsafePathError);
    await expect(safeWrite(ws, ws, 'x')).rejects.toThrow(UnsafePathError);
  });
  it('allows a workspace reached through a symlink', async () => {
    const { ws } = dirs();
    const link = ws + '-link';
    symlinkSync(ws, link);
    await safeWrite(link, path.join(link, 'f.txt'), 'ok');
    expect(readFileSync(path.join(ws, 'f.txt'), 'utf8')).toBe('ok');
  });
  it('approvals.jsonl and the reviews folder refuse symlinks', async () => {
    const { ws, outside } = dirs();
    mkdirSync(path.join(ws, '.kogentic'));
    symlinkSync(path.join(outside, 'log'), path.join(ws, '.kogentic', 'approvals.jsonl'));
    const rec = { planId: 'p', title: 't', status: 'approved' } as unknown as Parameters<typeof appendApproval>[1];
    await expect(appendApproval(ws, rec)).rejects.toThrow(UnsafePathError);
    expect(existsSync(path.join(outside, 'log'))).toBe(false);
    symlinkSync(outside, path.join(ws, '.kogentic', 'reviews'));
    const store = new ReviewStore(path.join(ws, '.kogentic', 'reviews'), ws);
    await expect(store.save(newReview('0123456789abcdef', '/p.md', 'h'))).rejects.toThrow(UnsafePathError);
    expect(readdirSync(outside)).toEqual([]);
  });
});
