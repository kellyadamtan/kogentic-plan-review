import MarkdownIt from 'markdown-it';
import type { ChecklistResult } from './checklist';
import type { Overlap } from './overlap';
import type { Plan } from './plan';
import { TRANSITIONS, type Review, type Status } from './review';
import { escapeHtml } from './text';

export interface ReviewView {
  plan: Plan;
  review: Review;
  checklist: ChecklistResult;
  overlaps: Overlap[];
  connectorEnabled: boolean;
}

export interface HtmlEnv {
  nonce: string;
  cspSource: string;
  scriptUri: string;
  styleUri: string;
}

const COMMENTABLE = new Set(['paragraph_open', 'heading_open', 'list_item_open', 'blockquote_open', 'table_open', 'fence', 'code_block']);

/**
 * Renders plan markdown with raw HTML disabled. Each heading, paragraph, list
 * item, quote, table and code block carries data-line (1-based, in the file).
 */
export function renderPlanMarkdown(body: string, bodyStartLine: number): string {
  const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
  md.core.ruler.push('kpr_lines', (state) => {
    for (const t of state.tokens) {
      if (t.map && COMMENTABLE.has(t.type)) {
        t.attrSet('data-line', String(t.map[0] + bodyStartLine));
        t.attrJoin('class', 'kpr-c');
      }
    }
  });
  return md.render(body);
}

export const STATUS_LABEL: Record<Status, string> = {
  pending: 'Pending',
  approved: 'Approved',
  changes_requested: 'Changes requested',
  rejected: 'Rejected',
  done: 'Done',
};

const AGENT_LABEL: Record<Plan['agent'], string> = {
  'claude-code': 'Claude Code',
  cursor: 'Cursor',
  copilot: 'Copilot',
  generic: 'Plan',
};

function button(action: string, label: string, primary = false): string {
  return `<button type="button" class="kpr-btn${primary ? ' kpr-primary' : ''}" data-action="${action}">${escapeHtml(label)}</button>`;
}

/** Action buttons allowed from the current status. */
export function actionsFor(status: Status): string[] {
  const allowed = TRANSITIONS[status];
  const out: string[] = [];
  if (allowed.includes('approved')) out.push('approve');
  if (allowed.includes('changes_requested')) out.push('requestChanges');
  if (allowed.includes('rejected')) out.push('reject');
  if (allowed.includes('done')) out.push('markDone');
  if (allowed.includes('pending')) out.push('reopen');
  return out;
}

const ACTION_LABEL: Record<string, string> = {
  approve: 'Approve',
  requestChanges: 'Request changes',
  reject: 'Reject',
  markDone: 'Mark done',
  reopen: 'Reopen',
};

/** Full webview HTML. Pure, so it can be unit tested. */
export function renderReviewHtml(v: ReviewView, env: HtmlEnv): string {
  const { plan, review, checklist, overlaps } = v;
  const csp = [
    "default-src 'none'",
    `img-src ${env.cspSource} data:`,
    `style-src ${env.cspSource}`,
    `script-src 'nonce-${env.nonce}'`,
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
  const e = escapeHtml;

  const todos = plan.todos.length
    ? `<section class="kpr-todos"><h2>Todos</h2><ul>${plan.todos
        .map((t) => `<li class="kpr-todo kpr-todo-${e(t.status.replace(/[^a-z_-]/gi, ''))}"><span class="kpr-todo-status">${e(t.status)}</span> ${e(t.content)}</li>`)
        .join('')}</ul></section>`
    : '';

  const checklistHtml = `<section class="kpr-checklist"><h2>Risk checklist <span class="kpr-count">${checklist.risks} risk${checklist.risks === 1 ? '' : 's'}</span></h2><ul>${checklist.items
    .map((i) => `<li class="kpr-item kpr-${i.level}" data-id="${e(i.id)}"><span class="kpr-level">${i.level}</span> <strong>${e(i.label)}</strong><div class="kpr-detail">${e(i.detail)}</div></li>`)
    .join('')}</ul></section>`;

  const overlapHtml = overlaps.length
    ? `<section class="kpr-overlaps"><h2>Overlapping plans</h2><p>Other open plans touch the same files. Merging both may conflict.</p><ul>${overlaps
        .map((o) => `<li><a href="#" data-action="openPlan" data-plan="${e(o.otherId)}">${e(o.otherTitle)}</a>: ${o.files.map((f) => `<code>${e(f)}</code>`).join(', ')}</li>`)
        .join('')}</ul></section>`
    : '';

  const comments = `<section class="kpr-comments"><h2>Comments (${review.comments.length})</h2>${
    review.comments.length
      ? `<ul>${[...review.comments]
          .sort((a, b) => a.line - b.line)
          .map((c) => `<li data-comment="${e(c.id)}"><a href="#" data-action="goto" data-line="${c.line}">Line ${c.line}</a>${c.excerpt ? ` <q>${e(c.excerpt)}</q>` : ''}<div class="kpr-ctext">${e(c.text)}</div><button type="button" class="kpr-link" data-action="deleteComment" data-id="${e(c.id)}">Delete</button></li>`)
          .join('')}</ul>`
      : '<p class="kpr-muted">Click any heading, paragraph or list item in the plan to comment on it.</p>'
  }</section>`;

  const actions = actionsFor(review.status);
  const decide = `<section class="kpr-decide"><label for="kpr-reason">Decision note (saved with the review in .kogentic/; not sent to the agent)</label><textarea id="kpr-reason" rows="3"></textarea><div class="kpr-actions">${actions
    .map((a) => button(a, ACTION_LABEL[a], a === 'approve'))
    .join('')}${button('export', 'Copy review as markdown')}${v.connectorEnabled ? button('send', 'Send to Kogentic…') : ''}</div></section>`;

  const meta = `<span class="kpr-badge">${e(AGENT_LABEL[plan.agent])}</span> <span class="kpr-status kpr-s-${review.status}">${e(STATUS_LABEL[review.status])}</span>${
    review.decidedBy ? ` <span class="kpr-muted">by ${e(review.decidedBy)}</span>` : ''
  }`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${e(env.styleUri)}">
<title>${e(plan.title)}</title>
</head>
<body data-hash="${e(plan.hash)}">
<header><h1>${e(plan.title)}</h1><div class="kpr-meta">${meta}</div><div class="kpr-path kpr-muted">${e(plan.path)}</div>${plan.overview ? `<p class="kpr-overview">${e(plan.overview)}</p>` : ''}</header>
<main class="kpr-layout">
<article class="kpr-plan">${todos}${renderPlanMarkdown(plan.body, plan.bodyStartLine)}</article>
<aside class="kpr-side">${decide}${overlapHtml}${checklistHtml}${comments}</aside>
</main>
<script nonce="${env.nonce}" src="${e(env.scriptUri)}"></script>
</body>
</html>`;
}

/** Markdown summary of a review (exportReview). */
export function reviewMarkdown(v: Omit<ReviewView, 'connectorEnabled'>): string {
  const { plan, review, checklist, overlaps } = v;
  const lines = [
    `## Plan review: ${plan.title}`,
    '',
    `- Status: ${STATUS_LABEL[review.status]}${review.decidedBy ? ` (by ${review.decidedBy})` : ''}`,
    `- Agent: ${AGENT_LABEL[plan.agent]}`,
    `- Plan hash: \`${plan.hash.slice(0, 12)}\``,
  ];
  if (review.reason) lines.push(`- Note: ${review.reason}`);
  lines.push('', `### Risk checklist (${checklist.risks} risks)`, '');
  for (const i of checklist.items) lines.push(`- [${i.level}] ${i.label}: ${i.detail}`);
  if (overlaps.length) {
    lines.push('', '### Overlapping plans', '');
    for (const o of overlaps) lines.push(`- ${o.otherTitle}: ${o.files.join(', ')}`);
  }
  if (review.comments.length) {
    lines.push('', '### Comments', '');
    for (const c of [...review.comments].sort((a, b) => a.line - b.line)) lines.push(`- Line ${c.line}: ${c.text}`);
  }
  return lines.join('\n') + '\n';
}
