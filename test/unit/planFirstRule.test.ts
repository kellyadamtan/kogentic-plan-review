import { describe, expect, it } from 'vitest';
import { PLAN_FIRST_RULE, withPlanFirstRule } from '../../src/core/planFirstRule';

describe('plan-first rule', () => {
  it('adds the rule once', () => {
    expect(withPlanFirstRule('')).toBe(PLAN_FIRST_RULE);
    const once = withPlanFirstRule('# Agents\nBe nice.\n\n\n')!;
    expect(once).toBe('# Agents\nBe nice.\n\n' + PLAN_FIRST_RULE);
    expect(withPlanFirstRule(once)).toBeUndefined();
  });
});
