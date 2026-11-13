export const RULE_MARKER = '<!-- kogentic-plan-review:plan-first -->';

/** A soft gate for agents without a hook: write PLAN.md, then wait. */
export const PLAN_FIRST_RULE = `${RULE_MARKER}
## Plan first

Before changing any code, write your plan to \`PLAN.md\` at the repository root:
what you will change, which files you will touch, and how you will test it.
Then stop and wait. Do not edit other files until the plan has been approved
in Kogentic Plan Review (or the user says "approved"). If the plan is rejected
or changes are requested, update \`PLAN.md\` and wait again.
`;

/** Returns the new file text, or undefined if the rule is already there. */
export function withPlanFirstRule(existing: string): string | undefined {
  if (existing.includes(RULE_MARKER)) return undefined;
  if (!existing.trim()) return PLAN_FIRST_RULE;
  return existing.replace(/\s*$/, '\n\n') + PLAN_FIRST_RULE;
}
