// ─────────────────────────────────────────────────────────────────────────────
// secrets.js — API routing shim for Be Here pages.
//
// Every HTML page in this project still calls https://api.monday.com/v2 and
// (in staff.html) https://api.anthropic.com/v1/messages directly in source.
// This file installs a tiny fetch override that redirects those calls to a
// Cloudflare Worker which holds the real API tokens as encrypted secrets.
//
// Result: the Monday + Anthropic tokens never appear in any deployed JS,
// browser memory, network tab, or git history. The Worker validates the
// request Origin against an allowlist before forwarding.
//
// ── ROTATING TOKENS ────────────────────────────────────────────────────────
// Open Cloudflare → Workers & Pages → be-here-api-proxy → Settings →
// Variables and Secrets. Edit MONDAY_API_TOKEN or ANTHROPIC_KEY, paste new
// value, Save and deploy. No code change. No redeploy of any HTML page.
//
// ── CHANGING THE PROXY ─────────────────────────────────────────────────────
// If you redeploy the Worker under a different name or subdomain, update
// PROXY_BASE below and re-deploy the HTML pages.
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  const PROXY_BASE = 'https://be-here-api-proxy.joanne-950.workers.dev';

  // Upstream URL → proxy path mapping. Anything not in here passes through
  // untouched, so existing fetches to fonts.googleapis.com / Guesty / etc.
  // keep working as before.
  const UPSTREAM_MAP = {
    'https://api.monday.com/v2':              PROXY_BASE + '/monday',
    'https://api.anthropic.com/v1/messages':  PROXY_BASE + '/anthropic',
  };

  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;

  const origFetch = window.fetch.bind(window);

  window.fetch = function (input, init) {
    // input may be a string URL or a Request object
    let url = typeof input === 'string' ? input : (input && input.url) || '';
    const replacement = UPSTREAM_MAP[url];
    if (!replacement) return origFetch(input, init);

    // Redirect to the proxy. If the caller passed a Request object we need to
    // copy its method/headers/body into init since changing url alone isn't
    // possible on Request — Request objects are immutable.
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
