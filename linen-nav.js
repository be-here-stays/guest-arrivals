// ─────────────────────────────────────────────────────────────────────────────
// linen-nav.js — context-aware "back" button for linen pages.
//
// When linen-dashboard.html links to one of its satellite pages (Stock take,
// Returns, Bagging Rota, Transport), it appends ?from=linen-dashboard to the
// URL. This script rewrites the destination page's "← Hub" back button so it
// returns to the dashboard, keeping the user inside the linen flow until
// they explicitly step out via a hub-bound link.
//
// PERSISTENCE: the from-state is stored in sessionStorage so internal
// navigation between linen pages (rota → transport via the header chip,
// transport → rota, etc.) keeps the back button correct without each link
// having to propagate the URL parameter. Visiting hub.html clears the state.
//
// EXTENDING: to add another working page as a back-nav source, register it
// in the TARGETS map below.
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  const STORAGE_KEY = 'bh.linenBack';

  // Map of `?from=` values → where the back button should point
  const TARGETS = {
    'linen-dashboard': { href: 'linen-dashboard.html', label: 'Linen Dashboard' },
  };

  // Visiting the hub clears the chain — fresh start
  if (/(^|\/)hub\.html$/i.test(location.pathname)) {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch (_) {}
    return;
  }

  // URL ?from=X takes precedence over stored value
  const params = new URLSearchParams(location.search);
  const fromParam = params.get('from');
  if (fromParam && TARGETS[fromParam]) {
    try { sessionStorage.setItem(STORAGE_KEY, fromParam); } catch (_) {}
  }

  const from = (() => {
    try { return sessionStorage.getItem(STORAGE_KEY); } catch (_) { return null; }
  })();
  if (!from) return;

  const target = TARGETS[from];
  if (!target) return;

  function applyBack() {
    // Only rewrite if the page's existing back button points at hub.html.
    // Pages that already have a custom back link are left untouched.
    const btn = document.querySelector('.back-btn');
    if (!btn) return;
    const href = btn.getAttribute('href') || '';
    if (!/(^|\/)hub\.html$/i.test(href)) return;
    btn.href = target.href;
    btn.textContent = '← ' + target.label;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyBack);
  } else {
    applyBack();
  }
})();
