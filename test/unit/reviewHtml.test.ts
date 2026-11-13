import { describe, expect, it } from 'vitest';
import { buildChecklist } from '../../src/core/checklist';
import { parsePlan } from '../../src/core/plan';
import { addComment, newReview } from '../../src/core/review';
import { actionsFor, renderPlanMarkdown, renderReviewHtml, reviewMarkdown } from '../../src/core/reviewHtml';

const env = { nonce: 'N0NCE', cspSource: 'vscode-resource:', scriptUri: 'res/review.js', styleUri: 'res/review.css' };

describe('review HTML', () => {
  it('adds file line numbers to commentable blocks', () => {
    const html = renderPlanMarkdown('# T\n\npara\n\n- a\n- b\n', 5);
    expect(html).toContain('<h1 data-line="5" class="kpr-c">');
    expect(html).toContain('<p data-line="7" class="kpr-c">');
    expect(html).toContain('<li data-line="9" class="kpr-c">');
    expect(html).toContain('<li data-line="10" class="kpr-c">');
  });
  it('escapes raw HTML and blocks script links', () => {
    const html = renderPlanMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[x](javascript:alert(1))', 1);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href="javascript:');
  });
  it('builds a locked-down page with a nonce CSP', () => {
    const plan = parsePlan('---\nname: "<b>x</b>"\ntodos:\n  - content: t1\n    status: completed\n---\n# T\n- `src/a.ts`\n', '/r/x.plan.md');
    let review = newReview(plan.id, plan.path, plan.hash);
    review = addComment(review, 3, 'ex', '<i>c</i>');
    const html = renderReviewHtml({ plan, review, checklist: buildChecklist(plan, () => true), overlaps: [{ otherId: 'o', otherTitle: 'Other', files: ['src/a.ts'] }], connectorEnabled: false }, env);
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src 'nonce-N0NCE'");
    expect(html).not.toMatch(/unsafe-inline|unsafe-eval|https:/);
    expect(html).toContain('<script nonce="N0NCE" src="res/review.js">');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('&lt;i&gt;c&lt;/i&gt;');
    expect(html).not.toContain('waiting for your decision');
    expect(html).toContain('Overlapping plans');
    expect(html).toContain('kpr-todo-completed');
    expect(html).not.toContain('Send to Kogentic');
    expect(html).toContain('data-action="approve"');
  });
  it('shows the send button only when the connector is enabled', () => {
    const plan = parsePlan('# T', '/r/PLAN.md');
    const review = newReview(plan.id, plan.path, plan.hash);
    const html = renderReviewHtml({ plan, review, checklist: buildChecklist(plan, () => true), overlaps: [], connectorEnabled: true }, env);
    expect(html).toContain('Send to Kogentic');
  });
  it('offers only valid actions', () => {
    expect(actionsFor('pending')).toEqual(['approve', 'requestChanges', 'reject']);
    expect(actionsFor('approved')).toEqual(['markDone', 'reopen']);
    expect(actionsFor('done')).toEqual([]);
  });
  it('exports a markdown summary', () => {
    const plan = parsePlan('# T\n- `src/a.ts`', '/r/PLAN.md');
    const review = addComment(newReview(plan.id, plan.path, plan.hash), 2, '', 'why?');
    const md = reviewMarkdown({ plan, review, checklist: buildChecklist(plan, () => true), overlaps: [] });
    expect(md).toContain('## Plan review: T');
    expect(md).toContain('- Line 2: why?');
    expect(md).toContain('[risk] Tests');
  });
});
