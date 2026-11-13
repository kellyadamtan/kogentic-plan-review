import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadErrorSummary, readPlanFiles } from '../../src/core/load';

describe('reading plan files', () => {
  it('reports unreadable files instead of skipping them', async () => {
    const read = async (p: string) => {
      if (p === 'bad.md') throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      return `text of ${p}`;
    };
    const r = await readPlanFiles(['a.md', 'bad.md', 'b.md'], read);
    expect(r.loaded).toEqual([{ path: 'a.md', text: 'text of a.md' }, { path: 'b.md', text: 'text of b.md' }]);
    expect(r.errors).toEqual([{ path: 'bad.md', message: 'EACCES: permission denied' }]);
    expect(loadErrorSummary(r.errors)).toBe('Kogentic Plan Review could not read 1 plan file: bad.md (EACCES: permission denied).');
  });
  it('reports a real missing file and a directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kpr-load-'));
    writeFileSync(join(dir, 'ok.md'), '# ok');
    const r = await readPlanFiles([join(dir, 'ok.md'), join(dir, 'gone.md'), dir], (p) => readFile(p, 'utf8'));
    expect(r.loaded).toHaveLength(1);
    expect(r.errors.map((e) => e.message.split(':')[0])).toEqual(['ENOENT', 'EISDIR']);
    expect(loadErrorSummary(r.errors)).toMatch(/could not read 2 plan files: .*gone\.md .* and 1 more\.$/);
  });
  it('reports a file without read permission (when not running as root)', async () => {
    if (process.getuid?.() === 0 || process.platform === 'win32') return;
    const dir = mkdtempSync(join(tmpdir(), 'kpr-load-'));
    const f = join(dir, 'locked.md');
    writeFileSync(f, '# x');
    chmodSync(f, 0o000);
    const r = await readPlanFiles([f], (p) => readFile(p, 'utf8'));
    expect(r.errors[0].message).toMatch(/^EACCES/);
  });
  it('has no summary when everything was read', () => {
    expect(loadErrorSummary([])).toBeUndefined();
  });
});
