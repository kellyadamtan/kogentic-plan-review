import { describe, expect, it } from 'vitest';
import { detectAgent, extractFiles, parsePlan, planId, splitFrontmatter } from '../../src/core/plan';
import { findVague, looksLikePath, normalizePath, sha256 } from '../../src/core/text';

const CURSOR = `---
name: Add rate limiting
overview: Limit login attempts per IP.
todos:
  - id: mw
    content: Add middleware in \`src/middleware/rateLimit.ts\`
    status: pending
  - id: tests
    content: Write tests
    status: completed
---

# Rate limiting

1. Create the middleware.
2. Register it in src/server.ts.
`;

const CLAUDE = `# Refactor auth

## Context
The auth code is split across files.

## Files to modify
- src/auth/session.ts - move token logic
- \`src/auth/login.ts\`
- README.md

## Steps
1. Extract helpers
2. Update callers

\`\`\`ts
import x from 'not/a/plan/file.ts';
\`\`\`
`;

describe('detectAgent', () => {
  it('detects each agent from the path', () => {
    expect(detectAgent('/home/u/.cursor/plans/x.plan.md')).toBe('cursor');
    expect(detectAgent('/repo/foo.plan.md')).toBe('cursor');
    expect(detectAgent('/repo/.cursor/plans/foo.md')).toBe('cursor');
    expect(detectAgent('/home/u/.claude/plans/happy-cat.md')).toBe('claude-code');
    expect(detectAgent('/repo/.github/plans/x.md')).toBe('copilot');
    expect(detectAgent('/repo/copilot-plan.md')).toBe('copilot');
    expect(detectAgent('/repo/PLAN.md')).toBe('generic');
    expect(detectAgent('C:\\Users\\u\\.claude\\plans\\a.md')).toBe('claude-code');
  });
  it('honours plansDirectory and forced agents', () => {
    expect(detectAgent('/repo/my-plans/a.md', { claudePlanDirs: ['/repo/my-plans/'] })).toBe('claude-code');
    expect(detectAgent('/repo/my-plansX/a.md', { claudePlanDirs: ['/repo/my-plans'] })).toBe('generic');
    expect(detectAgent('/repo/PLAN.md', { agent: 'copilot' })).toBe('copilot');
  });
});

describe('frontmatter', () => {
  it('splits YAML and body and reports the body start line', () => {
    const fm = splitFrontmatter('---\na: 1\nb: 2\n---\nhello\n');
    expect(fm.data).toEqual({ a: 1, b: 2 });
    expect(fm.body).toBe('hello\n');
    expect(fm.bodyStartLine).toBe(5);
    expect(fm.error).toBeUndefined();
  });
  it('treats text without frontmatter as body', () => {
    const fm = splitFrontmatter('# hi\n');
    expect(fm.data).toEqual({});
    expect(fm.bodyStartLine).toBe(1);
  });
  it('reports broken YAML without throwing', () => {
    const fm = splitFrontmatter('---\nname: [unclosed\n---\nbody\n');
    expect(fm.error).toBeTruthy();
    expect(fm.body).toBe('body\n');
  });
  it('reports non-mapping frontmatter', () => {
    expect(splitFrontmatter('---\n- a\n- b\n---\nx').error).toMatch(/mapping/);
  });
  it('handles CRLF', () => {
    expect(splitFrontmatter('---\r\nname: x\r\n---\r\nbody').data).toEqual({ name: 'x' });
  });
});

describe('parsePlan', () => {
  it('parses a Cursor plan', () => {
    const p = parsePlan(CURSOR, '/repo/.cursor/plans/rate.plan.md');
    expect(p.agent).toBe('cursor');
    expect(p.title).toBe('Add rate limiting');
    expect(p.overview).toBe('Limit login attempts per IP.');
    expect(p.todos).toEqual([
      { id: 'mw', content: 'Add middleware in `src/middleware/rateLimit.ts`', status: 'pending' },
      { id: 'tests', content: 'Write tests', status: 'completed' },
    ]);
    expect(p.files).toEqual(['src/middleware/rateLimit.ts', 'src/server.ts']);
    expect(p.steps).toEqual(['Create the middleware.', 'Register it in src/server.ts.']);
    expect(p.bodyStartLine).toBe(12);
    expect(p.hash).toBe(sha256(CURSOR));
    expect(p.id).toBe(planId('/repo/.cursor/plans/rate.plan.md'));
    expect(p.id).toHaveLength(16);
  });
  it('parses a Claude Code plan with a Files to modify section', () => {
    const p = parsePlan(CLAUDE, '/home/u/.claude/plans/a.md');
    expect(p.agent).toBe('claude-code');
    expect(p.title).toBe('Refactor auth');
    expect(p.files).toEqual(['README.md', 'src/auth/login.ts', 'src/auth/session.ts']);
    expect(p.files).not.toContain('not/a/plan/file.ts');
    expect(p.steps).toContain('Extract helpers');
    expect(p.todos).toEqual([]);
  });
  it('falls back to the file name for the title', () => {
    expect(parsePlan('just text', '/repo/plans/my-idea.md').title).toBe('my-idea');
    expect(parsePlan('', '/repo/x/foo.plan.md').title).toBe('foo');
  });
  it('uses frontmatter title when there is no name', () => {
    expect(parsePlan('---\ntitle: T\n---\n# H\n', '/r/PLAN.md').title).toBe('T');
  });
  it('accepts string todos and numeric ids', () => {
    const p = parsePlan('---\ntodos:\n  - do a\n  - id: 7\n    content: b\n  - {}\n---\n', '/r/x.plan.md');
    expect(p.todos).toEqual([
      { id: '1', content: 'do a', status: 'pending' },
      { id: '7', content: 'b', status: 'pending' },
    ]);
  });
  it('hash changes when the text changes and ignores CRLF', () => {
    expect(parsePlan('a\nb', '/r/PLAN.md').hash).toBe(parsePlan('a\r\nb', '/r/PLAN.md').hash);
    expect(parsePlan('a\nb', '/r/PLAN.md').hash).not.toBe(parsePlan('a\nc', '/r/PLAN.md').hash);
  });
});

describe('file extraction', () => {
  it('finds backticked and bare paths, not URLs or commands', () => {
    const md = 'Edit `src/a.ts:12` and lib/b.go. See https://x.com/a/b.html and run `npm test`. Bump 1.2.3. Use `foo()`.';
    expect(extractFiles(md)).toEqual(['lib/b.go', 'src/a.ts']);
  });
  it('ignores paths inside fenced code blocks', () => {
    expect(extractFiles('Edit `src/a.ts`.\n\n```sh\nrm src/old/file.ts\ncat `src/b.ts`\n```\n\n~~~\nlib/c.go\n~~~\nThen lib/d.go')).toEqual(['lib/d.go', 'src/a.ts']);
  });
  it('accepts known files and folders', () => {
    expect(extractFiles('Change `Dockerfile`, `.env.local` and `src/components/`.')).toEqual(['.env.local', 'Dockerfile', 'src/components/']);
  });
  it('normalizes paths', () => {
    expect(normalizePath('`./src/a.ts:3-9`,')).toBe('src/a.ts');
    expect(normalizePath('src\\win\\a.ts')).toBe('src/win/a.ts');
  });
  it('rejects non-paths', () => {
    for (const t of ['hello', 'a b/c.ts', '1.2.3', '--flag', 'x=1', 'http://a/b.ts', '$HOME/x.ts', '/usr/bin/']) {
      expect(looksLikePath(t), t).toBe(false);
    }
    for (const t of ['a.ts', 'src/a', 'src/', '/abs/x.ts']) {
      expect(looksLikePath(t), t).toBe(t !== 'src/a');
    }
  });
});

describe('findVague', () => {
  it('flags vague phrases by word', () => {
    expect(findVague('Clean up the code as needed.')).toEqual(['clean up', 'as needed']);
    expect(findVague('Add a cleanup job')).toEqual([]);
    expect(findVague('improvement')).toEqual([]);
  });
});
