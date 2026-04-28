/*
 * Shared email dispatcher for Be Here rota tools.
 * Provides a preview modal + POST to a Make.com webhook.
 *
 * Usage:
 *   WorkDispatch.showPreview({
 *     title: 'Laundry run — Mon 28 Apr',
 *     kind: 'laundry',      // free-form tag included in the payload
 *     drafts: [
 *       { to: 'driver@example.com', name: 'Dave', subject: '…', bodyHtml: '<p>…</p>', bodyText: '…' },
 *       …
 *     ],
 *     onSent: (result) => { … },  // optional callback after successful POST
 *   });
 *
 * Webhook URL is stored in localStorage under WEBHOOK_KEY. The planner can
 * set/change it via WorkDispatch.showSettings() (bound to the ⚙ gear in
 * each page's header).
 *
 * Payload sent to the webhook:
 *   {
 *     kind: 'laundry' | 'checker' | 'cleaners',
 *     title: '…',
 *     sentAt: '2026-04-23T10:11:12Z',
 *     sentBy: '<window.location.origin + page>',
 *     emails: [
 *       { to, name, subject, bodyHtml, bodyText },
 *       …
 *     ]
 *   }
 */
(function() {
  const WEBHOOK_KEY = 'beHere_sendWorkWebhook_v1';
  const ns = window.WorkDispatch = window.WorkDispatch || {};

  function getWebhook() {
    return localStorage.getItem(WEBHOOK_KEY) || '';
  }
  function setWebhook(url) {
    localStorage.setItem(WEBHOOK_KEY, url || '');
  }

  function escHTML(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function ensureStyles() {
    if (document.getElementById('wd-styles')) return;
    const s = document.createElement('style');
    s.id = 'wd-styles';
    s.textContent = `
      .wd-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;align-items:flex-start;justify-content:center;z-index:5000;padding:24px;overflow:auto}
      .wd-overlay.open{display:flex}
      .wd-box{background:#fff;color:#272F2E;border-radius:12px;width:100%;max-width:720px;padding:18px 20px;box-shadow:0 14px 60px rgba(0,0,0,.3);font-family:'Instrument Sans',system-ui,sans-serif}
      .wd-box h2{margin:0 0 4px;font-size:17px}
      .wd-box .wd-sub{font-size:12px;color:#7b7a71;margin-bottom:12px}
      .wd-list{max-height:58vh;overflow:auto;border:1px solid #e5e4df;border-radius:8px}
      .wd-row{border-bottom:1px solid #e5e4df;padding:10px 12px}
      .wd-row:last-child{border-bottom:none}
      .wd-row header{display:flex;gap:8px;align-items:center;margin-bottom:4px}
      .wd-row header .wd-name{font-weight:700;font-size:13px}
      .wd-row header .wd-to{font-size:12px;color:#646955;margin-left:auto;font-variant-numeric:tabular-nums}
      .wd-row header .wd-bad{color:#a9434a;font-weight:700}
      .wd-row .wd-subj{font-size:13px;font-weight:600;margin:4px 0}
      .wd-row .wd-body{font-size:12px;white-space:pre-wrap;background:#faf8f2;border:1px solid #eee7d5;border-radius:6px;padding:8px 10px;max-height:150px;overflow:auto}
      .wd-row .wd-chk{display:flex;gap:6px;align-items:center;font-size:12px;color:#646955;margin-top:6px}
      .wd-row.wd-skip .wd-subj, .wd-row.wd-skip .wd-body{opacity:.4}
      .wd-btns{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap}
      .wd-btn{padding:9px 14px;border:0;border-radius:8px;font:inherit;font-size:13px;font-weight:700;cursor:pointer;flex:1;min-width:110px}
      .wd-btn.pri{background:#646955;color:#fff}
      .wd-btn.sec{background:#e5e4df;color:#272F2E}
      .wd-btn.warn{background:#AF926A;color:#fff}
      .wd-btn:disabled{opacity:.5;cursor:not-allowed}
      .wd-status{margin-top:10px;font-size:12px;min-height:18px}
      .wd-status.ok{color:#2a7f4f;font-weight:700}
      .wd-status.err{color:#a9434a;font-weight:700}
      .wd-settings-input{width:100%;padding:8px 10px;border:1px solid #e5e4df;border-radius:6px;font:inherit;font-size:13px;margin-top:4px;font-family:ui-monospace,Menlo,monospace}
    `;
    document.head.appendChild(s);
  }

  function ensureOverlay() {
    ensureStyles();
    let o = document.getElementById('wd-overlay');
    if (!o) {
      o = document.createElement('div');
      o.id = 'wd-overlay';
      o.className = 'wd-overlay';
      document.body.appendChild(o);
    }
    return o;
  }

  /**
   * Open the email preview modal.
   * Each draft carries a `skip` flag the planner can toggle per row.
   */
  ns.showPreview = function(opts) {
    const overlay = ensureOverlay();
    const drafts = (opts.drafts || []).map(d => Object.assign({ skip: !d.to }, d));
    const title = opts.title || 'Send work';
    const kind = opts.kind || 'generic';

    function render() {
      const rows = drafts.map((d, i) => `
        <div class="wd-row${d.skip ? ' wd-skip' : ''}" data-i="${i}">
          <header>
            <span class="wd-name">${escHTML(d.name || '—')}</span>
            <span class="wd-to ${d.to ? '' : 'wd-bad'}">${d.to ? escHTML(d.to) : 'no email on file'}</span>
          </header>
          <div class="wd-subj">${escHTML(d.subject || '')}</div>
          <div class="wd-body">${escHTML(d.bodyText || '').slice(0, 600)}${(d.bodyText || '').length > 600 ? '…' : ''}</div>
          <label class="wd-chk"><input type="checkbox" data-skip="${i}" ${d.skip ? 'checked' : ''} ${d.to ? '' : 'disabled'}> Skip this recipient</label>
        </div>
      `).join('');

      const toSendCount = drafts.filter(d => !d.skip && d.to).length;
      const webhook = getWebhook();

      overlay.innerHTML = `
        <div class="wd-box">
          <h2>${escHTML(title)}</h2>
          <div class="wd-sub">${drafts.length} recipient${drafts.length === 1 ? '' : 's'} · ${toSendCount} will be sent · ${drafts.length - toSendCount} skipped/missing</div>
          <div class="wd-list">${rows || '<div class="wd-row" style="color:#7b7a71">No recipients.</div>'}</div>
          <div class="wd-status" id="wd-status">${webhook ? '' : '⚠ No webhook configured — click Settings to set one.'}</div>
          <div class="wd-btns">
            <button class="wd-btn pri" id="wd-send" ${toSendCount && webhook ? '' : 'disabled'}>Send ${toSendCount}</button>
            <button class="wd-btn warn" id="wd-settings">⚙ Webhook</button>
            <button class="wd-btn sec" id="wd-close">Close</button>
          </div>
        </div>`;
      overlay.classList.add('open');

      overlay.querySelectorAll('input[data-skip]').forEach(cb => {
        cb.addEventListener('change', e => {
          const i = parseInt(e.target.getAttribute('data-skip'));
          drafts[i].skip = e.target.checked;
          render();
        });
      });
      document.getElementById('wd-close').addEventListener('click', () => overlay.classList.remove('open'));
      document.getElementById('wd-settings').addEventListener('click', () => ns.showSettings(render));
      document.getElementById('wd-send').addEventListener('click', async () => {
        const btn = document.getElementById('wd-send');
        const status = document.getElementById('wd-status');
        const toSend = drafts.filter(d => !d.skip && d.to);
        if (!toSend.length) return;
        const webhook = getWebhook();
        if (!webhook) { status.textContent = '⚠ No webhook configured.'; status.className = 'wd-status err'; return; }
        btn.disabled = true; status.textContent = 'Sending…'; status.className = 'wd-status';
        try {
          const payload = {
            kind,
            title,
            sentAt: new Date().toISOString(),
            sentBy: window.location.origin + window.location.pathname,
            emails: toSend.map(d => ({ to: d.to, name: d.name || '', subject: d.subject || '', bodyHtml: d.bodyHtml || '', bodyText: d.bodyText || '' })),
          };
          const r = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          status.textContent = `✓ Sent ${toSend.length} email${toSend.length === 1 ? '' : 's'}.`;
          status.className = 'wd-status ok';
          if (typeof opts.onSent === 'function') opts.onSent({ sent: toSend.length });
          setTimeout(() => overlay.classList.remove('open'), 1500);
        } catch (e) {
          status.textContent = 'Send failed: ' + (e.message || e);
          status.className = 'wd-status err';
          btn.disabled = false;
        }
      });
    }

    render();
  };

  /**
   * Open a small modal to set the webhook URL. onClose is invoked after save/cancel.
   */
  ns.showSettings = function(onClose) {
    const overlay = ensureOverlay();
    const current = getWebhook();
    overlay.innerHTML = `
      <div class="wd-box" style="max-width:480px">
        <h2>Send-work webhook</h2>
        <div class="wd-sub">POSTs the email batch as JSON. Paste your Make.com custom-webhook URL below.</div>
        <input class="wd-settings-input" id="wd-url" placeholder="https://hook.eu1.make.com/…" value="${escHTML(current)}">
        <div class="wd-btns">
          <button class="wd-btn pri" id="wd-save">Save</button>
          <button class="wd-btn sec" id="wd-cancel">Cancel</button>
        </div>
      </div>`;
    overlay.classList.add('open');
    document.getElementById('wd-save').addEventListener('click', () => {
      const v = (document.getElementById('wd-url').value || '').trim();
      setWebhook(v);
      overlay.classList.remove('open');
      if (typeof onClose === 'function') onClose();
    });
    document.getElementById('wd-cancel').addEventListener('click', () => {
      overlay.classList.remove('open');
      if (typeof onClose === 'function') onClose();
    });
  };

  ns.getWebhook = getWebhook;
  ns.setWebhook = setWebhook;
})();
