import { describe, expect, it } from 'vitest';
import { checkPanelMessage } from '../../src/core/panelMessage';

describe('webview messages', () => {
  it('refuses a decision made on text that has since changed', () => {
    expect(checkPanelMessage({ type: 'decide', action: 'approve', hash: 'old' }, 'new')).toEqual({ ok: false, why: 'stale' });
    expect(checkPanelMessage({ type: 'comment', line: 1, text: 'x', hash: 'old' }, 'new')).toEqual({ ok: false, why: 'stale' });
    expect(checkPanelMessage({ type: 'decide', action: 'approve' }, 'new')).toEqual({ ok: false, why: 'stale' });
  });
  it('accepts a decision on the current text', () => {
    expect(checkPanelMessage({ type: 'decide', action: 'approve', hash: 'h' }, 'h')).toEqual({ ok: true, cmd: { type: 'decide', action: 'approve', reason: undefined } });
    expect(checkPanelMessage({ type: 'comment', line: 3, excerpt: 'e', text: 't', hash: 'h' }, 'h')).toEqual({ ok: true, cmd: { type: 'comment', line: 3, excerpt: 'e', text: 't' } });
    expect(checkPanelMessage({ type: 'export', hash: 'h' }, 'h')).toEqual({ ok: true, cmd: { type: 'export' } });
  });
  it('ignores malformed messages', () => {
    expect(checkPanelMessage(null, 'h').ok).toBe(false);
    expect(checkPanelMessage({ type: 'decide', action: 'delete', hash: 'h' }, 'h')).toEqual({ ok: false, why: 'invalid' });
    expect(checkPanelMessage({ type: 'comment', line: 'x', text: 't', hash: 'h' }, 'h')).toEqual({ ok: false, why: 'invalid' });
    expect(checkPanelMessage({ type: 'eval', hash: 'h' }, 'h')).toEqual({ ok: false, why: 'invalid' });
  });
});
