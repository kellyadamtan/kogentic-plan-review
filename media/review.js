// @ts-check
// Webview script for the Kogentic plan review panel. No network access (CSP).
(function () {
  const vscode = acquireVsCodeApi();
  const hash = document.body.dataset.hash;

  /** @param {Record<string, unknown>} msg */
  function post(msg) {
    vscode.postMessage(Object.assign({ hash }, msg));
  }

  function reason() {
    const el = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('kpr-reason'));
    return el ? el.value.trim() : '';
  }

  function closeForms() {
    document.querySelectorAll('.kpr-form').forEach((f) => f.remove());
  }

  /** @param {HTMLElement} block */
  function openForm(block) {
    closeForms();
    const line = Number(block.dataset.line || '1');
    const excerpt = (block.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    const form = document.createElement('div');
    form.className = 'kpr-form';
    const label = document.createElement('label');
    label.textContent = 'Comment on line ' + line;
    const ta = document.createElement('textarea');
    ta.rows = 3;
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'kpr-btn kpr-primary';
    save.textContent = 'Add comment';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'kpr-btn';
    cancel.textContent = 'Cancel';
    save.addEventListener('click', (e) => {
      e.stopPropagation();
      const text = ta.value.trim();
      if (text) post({ type: 'comment', line, excerpt, text });
      closeForms();
    });
    cancel.addEventListener('click', (e) => {
      e.stopPropagation();
      closeForms();
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeForms();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save.click();
    });
    form.append(label, ta, save, cancel);
    form.addEventListener('click', (e) => e.stopPropagation());
    block.insertAdjacentElement('afterend', form);
    ta.focus();
  }

  document.addEventListener('click', (ev) => {
    const target = /** @type {HTMLElement} */ (ev.target);
    const actionEl = /** @type {HTMLElement | null} */ (target.closest('[data-action]'));
    if (actionEl) {
      ev.preventDefault();
      const a = actionEl.dataset.action;
      if (a === 'approve' || a === 'requestChanges' || a === 'reject' || a === 'markDone' || a === 'reopen') {
        post({ type: 'decide', action: a, reason: reason() });
      } else if (a === 'deleteComment') {
        post({ type: 'deleteComment', id: actionEl.dataset.id });
      } else if (a === 'openPlan') {
        post({ type: 'openPlan', id: actionEl.dataset.plan });
      } else if (a === 'goto') {
        const el = document.querySelector('.kpr-c[data-line="' + actionEl.dataset.line + '"]');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('kpr-flash');
          setTimeout(() => el.classList.remove('kpr-flash'), 1200);
        }
      } else if (a === 'export') {
        post({ type: 'export' });
      } else if (a === 'send') {
        post({ type: 'send' });
      }
      return;
    }
    if (target.closest('a')) {
      // Links in plans are not followed inside the webview.
      ev.preventDefault();
      return;
    }
    const block = /** @type {HTMLElement | null} */ (target.closest('.kpr-plan .kpr-c'));
    if (block && !window.getSelection()?.toString()) openForm(block);
  });
})();
