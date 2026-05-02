// ─────────────────────────────────────────────────────────────────────────────
// secrets.js — API routing shim for Be Here pages.
//
// HTML pages in this project still call upstream API URLs directly in source:
//   • https://api.monday.com/v2                  (most pages)
//   • https://api.anthropic.com/v1/messages      (staff.html)
//   • https://open-api.guesty.com/v1/...         (supplies-hub.html)
//   • https://auth.guesty.com/oauth/token        (supplies-hub.html OAuth)
//
// This file installs a fetch override that redirects each of those to a
// Cloudflare Worker which holds the real API credentials as encrypted
// secrets and (for Guesty) handles the OAuth exchange server-side.
//
// Result: API tokens never appear in any deployed JS, browser memory,
// network tab, or git history. The Worker validates the request Origin
// against an allowlist before forwarding.
//
// ── ROTATING TOKENS ────────────────────────────────────────────────────────
// Open Cloudflare → Workers & Pages → be-here-api-proxy → Settings →
// Variables and Secrets. Edit the relevant secret, paste new value, Save
// and deploy. No code change. No redeploy of any HTML page.
//
//   MONDAY_API_TOKEN     — Monday JWT
//   ANTHROPIC_KEY        — Anthropic sk-ant-api03 key
//   GUESTY_CLIENT_ID     — Guesty OAuth client id (only if you use Guesty)
//   GUESTY_CLIENT_SECRET — Guesty OAuth client secret
//
// ── CHANGING THE PROXY ─────────────────────────────────────────────────────
// If you redeploy the Worker under a different name or subdomain, update
// PROXY_BASE below and re-deploy the HTML pages.
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  const PROXY_BASE = 'https://be-here-api-proxy.joanne-950.workers.dev';

  // Compute the proxy-side URL for a given upstream URL.
  // Returns null if the URL doesn't need redirection.
  function rewriteUrl(url) {
    if (!url) return null;
    if (url === 'https://api.monday.com/v2')             return PROXY_BASE + '/monday';
    if (url === 'https://api.anthropic.com/v1/messages') return PROXY_BASE + '/anthropic';

    // Guesty: forward path + query, Worker attaches OAuth token.
    const GUESTY_OPEN = 'https://open-api.guesty.com';
    if (url === GUESTY_OPEN || url.startsWith(GUESTY_OPEN + '/')) {
      return PROXY_BASE + '/guesty' + url.slice(GUESTY_OPEN.length);
    }
    // Legacy OAuth call from supplies-hub.html — return a stub token via the
    // Worker so existing page logic keeps working.
    if (url === 'https://auth.guesty.com/oauth/token') {
      return PROXY_BASE + '/guesty/oauth/token-stub';
    }
    return null;
  }

  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;

  const origFetch = window.fetch.bind(window);

  window.fetch = function (input, init) {
    const inputUrl = typeof input === 'string' ? input : (input && input.url) || '';
    const replacement = rewriteUrl(inputUrl);
    if (!replacement) return origFetch(input, init);

    // Redirect to the proxy. If the caller passed a Request object we copy
    // its method/headers/body into init since the URL on a Request is immutable.
    if (typeof input === 'string') {
      return origFetch(replacement, init);
    }
    const newInit = init || {
      method:      input.method,
      headers:     input.headers,
      body:        input.body,
      mode:        input.mode,
      credentials: input.credentials,
      cache:       input.cache,
      redirect:    input.redirect,
      referrer:    input.referrer,
      integrity:   input.integrity,
    };
    return origFetch(replacement, newInit);
  };

  // Backwards-compat: pages still reference these globals in their fetch
  // headers (Authorization / x-api-key). The proxy ignores them and attaches
  // its own from server-side secrets. Empty strings keep the headers harmless.
  window.MONDAY_API_TOKEN = '';
  window.ANTHROPIC_KEY    = '';
  window.LINEN_API_BASE   = PROXY_BASE;
})();
