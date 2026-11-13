/** Messages the review webview may send. Everything else is ignored. */
export type PanelCommand =
  | { type: 'decide'; action: 'approve' | 'requestChanges' | 'reject' | 'markDone' | 'reopen'; reason?: string }
  | { type: 'comment'; line: number; excerpt: string; text: string }
  | { type: 'deleteComment'; id: string }
  | { type: 'openPlan'; id: string }
  | { type: 'export' }
  | { type: 'send' };

export type PanelCheck = { ok: true; cmd: PanelCommand } | { ok: false; why: 'stale' | 'invalid' };

const ACTIONS = new Set(['approve', 'requestChanges', 'reject', 'markDone', 'reopen']);
const MAX_TEXT = 5000;

/**
 * Validates a webview message against the plan currently shown. A message
 * carrying another plan hash is stale: the reviewer was looking at text that
 * has since changed, so nothing is applied and the panel is re-rendered.
 */
export function checkPanelMessage(m: unknown, currentHash: string): PanelCheck {
  if (!m || typeof m !== 'object') return { ok: false, why: 'invalid' };
  const o = m as Record<string, unknown>;
  if (o.hash !== currentHash) return { ok: false, why: 'stale' };
  switch (o.type) {
    case 'decide':
      if (typeof o.action !== 'string' || !ACTIONS.has(o.action)) return { ok: false, why: 'invalid' };
      return { ok: true, cmd: { type: 'decide', action: o.action as 'approve', reason: typeof o.reason === 'string' ? o.reason.slice(0, MAX_TEXT) : undefined } };
    case 'comment':
      if (typeof o.text !== 'string' || typeof o.line !== 'number' || !Number.isFinite(o.line)) return { ok: false, why: 'invalid' };
      return { ok: true, cmd: { type: 'comment', line: o.line, excerpt: typeof o.excerpt === 'string' ? o.excerpt : '', text: o.text.slice(0, MAX_TEXT) } };
    case 'deleteComment':
    case 'openPlan':
      if (typeof o.id !== 'string') return { ok: false, why: 'invalid' };
      return { ok: true, cmd: { type: o.type, id: o.id } };
    case 'export':
    case 'send':
      return { ok: true, cmd: { type: o.type } };
    default:
      return { ok: false, why: 'invalid' };
  }
}
