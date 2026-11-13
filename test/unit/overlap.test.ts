import { describe, expect, it } from 'vitest';
import { computeOverlaps, pathsOverlap } from '../../src/core/overlap';

describe('overlap detection', () => {
  it('finds shared files between open plans', () => {
    const m = computeOverlaps([
      { id: 'a', title: 'A', files: ['src/x.ts', 'src/y.ts'], open: true },
      { id: 'b', title: 'B', files: ['./src/x.ts', 'src/z.ts'], open: true },
      { id: 'c', title: 'C', files: ['docs/'], open: true },
    ]);
    expect(m.get('a')).toEqual([{ otherId: 'b', otherTitle: 'B', files: ['src/x.ts'] }]);
    expect(m.get('b')).toEqual([{ otherId: 'a', otherTitle: 'A', files: ['src/x.ts'] }]);
    expect(m.get('c')).toEqual([]);
  });
  it('ignores closed plans', () => {
    const m = computeOverlaps([
      { id: 'a', title: 'A', files: ['src/x.ts'], open: true },
      { id: 'b', title: 'B', files: ['src/x.ts'], open: false },
    ]);
    expect(m.get('a')).toEqual([]);
    expect(m.get('b')).toEqual([]);
  });
  it('treats a folder as overlapping files inside it', () => {
    const m = computeOverlaps([
      { id: 'a', title: 'A', files: ['src/auth/'], open: true },
      { id: 'b', title: 'B', files: ['src/auth/login.ts'], open: true },
    ]);
    expect(m.get('a')?.[0].files).toEqual(['src/auth/login.ts']);
  });
  it('matches whole path segments only, case-insensitively', () => {
    expect(pathsOverlap('src/a', 'src/ab.ts')).toBe(false);
    expect(pathsOverlap('SRC/A.ts', 'src/a.ts')).toBe(true);
    expect(pathsOverlap('src/a.ts', 'src/a.ts')).toBe(true);
    expect(pathsOverlap('src', 'src/a.ts')).toBe(true);
    expect(pathsOverlap('', 'src/a.ts')).toBe(false);
  });
  it('reports three-way overlaps for each plan', () => {
    const m = computeOverlaps(['a', 'b', 'c'].map((id) => ({ id, title: id, files: ['f.ts'], open: true })));
    expect(m.get('b')?.map((o) => o.otherId)).toEqual(['a', 'c']);
  });
});
