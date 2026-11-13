import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')) as {
  contributes: { commands: { command: string }[]; configuration: { properties: Record<string, { scope?: string; default?: unknown }> } };
};
const props = pkg.contributes.configuration.properties;

describe('package.json contributions', () => {
  it('settings a workspace must not control are machine-scoped and off by default', () => {
    for (const k of ['kogenticPlanReview.recordApprovals', 'kogenticPlanReview.kogentic.enabled', 'kogenticPlanReview.kogentic.baseUrl']) {
      expect(props[k]?.scope, k).toBe('machine');
    }
    expect(props['kogenticPlanReview.recordApprovals'].default).toBe(false);
    expect(props['kogenticPlanReview.kogentic.enabled'].default).toBe(false);
    expect(props['kogenticPlanReview.kogentic.baseUrl'].default).toBe('');
  });
  it('contributes no gate, hook or token commands or settings', () => {
    const names = [...pkg.contributes.commands.map((c) => c.command), ...Object.keys(props)];
    expect(names.filter((n) => /gate|hook|token|planfirst/i.test(n))).toEqual([]);
  });
});
