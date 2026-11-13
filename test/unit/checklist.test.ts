import { describe, expect, it } from 'vitest';
import { buildChecklist } from '../../src/core/checklist';
import { parsePlan } from '../../src/core/plan';

const all = () => true;
const ids = (md: string, exists = all) => buildChecklist(parsePlan(md, '/r/PLAN.md'), exists).items.map((i) => `${i.id}:${i.level}`);

describe('risk checklist', () => {
  it('a clean plan with tests has no risks', () => {
    const r = buildChecklist(parsePlan('# Add helper\n\n1. Add `src/util.ts`\n2. Add `src/util.test.ts`\n', '/r/PLAN.md'), all);
    expect(r.risks).toBe(0);
    expect(r.items.map((i) => i.id)).toEqual(['files', 'tests']);
    expect(r.items.find((i) => i.id === 'tests')?.level).toBe('ok');
  });
  it('flags missing tests as a risk', () => {
    expect(ids('# X\n1. Edit `src/a.ts`')).toContain('tests:risk');
  });
  it('flags migrations, deletes, dependencies, infra and secrets', () => {
    const md = [
      '# Big change',
      '- Add `db/migrations/001_users.sql`',
      '- Remove the old handler',
      '- Update `package.json`',
      '- Edit `.github/workflows/ci.yml` and `Dockerfile`',
      '- Read the key from `.env`',
      '- Add unit tests',
    ].join('\n');
    const r = buildChecklist(parsePlan(md, '/r/PLAN.md'), all);
    const got = Object.fromEntries(r.items.map((i) => [i.id, i.level]));
    expect(got).toMatchObject({ migrations: 'risk', deletes: 'risk', dependencies: 'risk', infra: 'risk', secrets: 'risk', tests: 'ok' });
    expect(r.risks).toBe(5);
  });
  it('detects risks from text alone', () => {
    const got = ids('# X\n- Write a migration to add column\n- npm install zod\n- rotate the API key\n- tests');
    expect(got).toEqual(expect.arrayContaining(['migrations:risk', 'dependencies:risk', 'secrets:risk']));
  });
  it('does not flag .env.example as a secret file', () => {
    expect(ids('# X\n- Update `.env.example`\n- tests').some((s) => s.startsWith('secrets'))).toBe(false);
  });
  it('reports files that do not exist', () => {
    const r = buildChecklist(parsePlan('# X\n- `src/new.ts` and `src/old.ts`\n- tests', '/r/PLAN.md'), (f) => f === 'src/old.ts');
    const miss = r.items.find((i) => i.id === 'missing-files');
    expect(miss?.detail).toContain('src/new.ts');
    expect(miss?.detail).not.toContain('src/old.ts');
  });
  it('notes when no files are named, vague phrases and long plans', () => {
    expect(ids('# X\nmake it better, tests')).toEqual(expect.arrayContaining(['files:info', 'vague:info']));
    const long = '# L\n' + Array.from({ length: 31 }, (_, i) => `${i + 1}. step with test`).join('\n');
    expect(ids(long)).toContain('length:info');
    const short = '# L\n' + Array.from({ length: 30 }, (_, i) => `${i + 1}. step with test`).join('\n');
    expect(ids(short)).not.toContain('length:info');
  });
  it('reports broken frontmatter', () => {
    expect(ids('---\nname: [x\n---\n# t\ntests')).toContain('frontmatter:info');
  });
});
