// ─────────────────────────────────────────────────────────────────────────────
// be-here-api-proxy — Cloudflare Worker
//
// One Worker fronts every external API call from the Be Here pages so that
// API tokens never live in browser-side JS or localStorage.
//
// Routes handled
//   POST /monday                  → https://api.monday.com/v2
//   POST /anthropic               → https://api.anthropic.com/v1/messages
//   POST /guesty/oauth/token-stub → returns a placeholder token
//   ANY  /guesty/*                → https://open-api.guesty.com/* (OAuth attached)
//
// Secrets (set via Cloudflare → Settings → Variables and Secrets)
//   MONDAY_API_TOKEN
//   ANTHROPIC_KEY
//   GUESTY_CLIENT_ID
//   GUESTY_CLIENT_SECRET
//
// KV binding (set via Cloudflare → Settings → Variables and Secrets → KV)
//   GUESTY_KV  — required. Stores the live Guesty access token + 429 back-off
//                marker. Without this binding, Guesty calls cannot work
//                because Guesty allows only 5 token fetches per day and a
//                per-isolate memory cache cannot survive cold starts.
//
// Origin allowlist
//   file://, localhost, be-here.travel, anything from a *.workers.dev preview,
//   and Cotswold Water Park Retreats domains. Edit ALLOW_ORIGINS to taste.
// ─────────────────────────────────────────────────────────────────────────────

const ALLOW_ORIGINS = [
  'null',                              // file:// pages send Origin: null
  'http://localhost',
  'http://127.0.0.1',
  'https://be-here.travel',
  'https://www.be-here.travel',
  'https://cotswoldwaterparkretreats.com',
  'https://www.cotswoldwaterparkretreats.com',
  'https://be-here-stays.github.io',   // GitHub Pages host for the Be Here pages
];

// KV keys used by the Guesty token logic.
const KV_TOKEN_KEY    = 'guesty:token';      // { access_token, exp_ms }
const KV_BACKOFF_KEY  = 'guesty:backoff';    // ms-since-epoch we may try again

// Per-isolate cache — saves a KV roundtrip on hot paths. KV is the source of
// truth; this is just a hint.
let _localToken    = null;
let _localTokenExp = 0;

export default {
  async fetch(request, env, ctx) {
    // Belt-and-braces wrapper: under no circumstances should this handler
    // return anything other than a Response. If it does, Cloudflare returns
    // "FetchEvent.respondWith received an error: Returned response is null"
    // to every page using the Worker, which breaks the entire app.
    let origin = '';
    try {
      origin = request.headers.get('Origin') || '';
      const resp = await routeRequest(request, env, origin);
      if (resp instanceof Response) {
        return withCors(resp, origin);
      }
      // Defensive: if a route handler somehow returned non-Response, log and
      // surface as a 500 instead of letting the runtime crash.
      console.error('Route handler returned non-Response:', typeof resp, resp);
      return withCors(jsonError(500,
        'Worker route handler returned a non-Response value (' + typeof resp + ')'), origin);
    } catch (err) {
      // Any thrown error — including those from withCors itself — should still
      // produce a Response. Logging goes to `wrangler tail` / dashboard logs.
      console.error('Worker fetch handler error:', err && err.stack || err);
      try {
        return withCors(jsonError(500,
          'Worker error: ' + String(err && err.message || err)), origin);
      } catch (_) {
        // Last-ditch fallback if even withCors fails (shouldn't happen).
        return new Response(JSON.stringify({
          error: 'Worker error (fallback): ' + String(err && err.message || err),
        }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
    }
  },
};

async function routeRequest(request, env, origin) {
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (url.pathname === '/monday')                  return proxyMonday(request, env);
  if (url.pathname === '/anthropic')               return proxyAnthropic(request, env);
  if (url.pathname === '/guesty/oauth/token-stub') return guestyStubToken();
  if (url.pathname === '/guesty' ||
      url.pathname.startsWith('/guesty/'))         return proxyGuesty(request, env, url);
  if (url.pathname === '/' ||
      url.pathname === '/health') {
    return new Response(JSON.stringify({
      ok: true,
      service: 'be-here-api-proxy',
      guestyKv: !!env.GUESTY_KV,
    }), { headers: { 'Content-Type': 'application/json' } });
  }
  if (url.pathname === '/guesty-token-state')      return guestyTokenState(env);
  return new Response('Not found', { status: 404 });
}

/* ── Monday ──────────────────────────────────────────────────────────────── */
async function proxyMonday(request, env) {
  if (!env.MONDAY_API_TOKEN) {
    return jsonError(500, 'Worker missing MONDAY_API_TOKEN secret');
  }
  const body = await request.text();
  const r = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': env.MONDAY_API_TOKEN,
      'API-Version':   '2024-01',
    },
    body,
  });
  return new Response(await r.text(), {
    status: r.status,
    headers: { 'Content-Type': r.headers.get('Content-Type') || 'application/json' },
  });
}

/* ── Anthropic ───────────────────────────────────────────────────────────── */
async function proxyAnthropic(request, env) {
  if (!env.ANTHROPIC_KEY) {
    return jsonError(500, 'Worker missing ANTHROPIC_KEY secret');
  }
  const body = await request.text();
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         env.ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body,
  });
  return new Response(await r.text(), {
    status: r.status,
    headers: { 'Content-Type': r.headers.get('Content-Type') || 'application/json' },
  });
}

/* ── Guesty: stub token returned to the browser ──────────────────────────── */
function guestyStubToken() {
  return new Response(JSON.stringify({
    access_token: 'worker-managed',
    token_type:   'Bearer',
    expires_in:   86400,
    scope:        'open-api',
  }), { headers: { 'Content-Type': 'application/json' } });
}

/* ── Guesty: token state diagnostic (no secrets exposed) ─────────────────── */
async function guestyTokenState(env) {
  const out = { kvBound: !!env.GUESTY_KV };
  if (env.GUESTY_KV) {
    const [tokRaw, backRaw] = await Promise.all([
      env.GUESTY_KV.get(KV_TOKEN_KEY),
      env.GUESTY_KV.get(KV_BACKOFF_KEY),
    ]);
    if (tokRaw) {
      try {
        const { exp_ms } = JSON.parse(tokRaw);
        out.token = {
          present: true,
          expiresInSec: Math.max(0, Math.round((exp_ms - Date.now()) / 1000)),
        };
      } catch (_) { out.token = { present: true, parseError: true }; }
    } else {
      out.token = { present: false };
    }
    if (backRaw) {
      const until = Number(backRaw);
      out.backoff = {
        active: until > Date.now(),
        secondsRemaining: Math.max(0, Math.round((until - Date.now()) / 1000)),
      };
    } else {
      out.backoff = { active: false };
    }
  }
  return new Response(JSON.stringify(out, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/* ── Guesty: real token, cached in KV across all isolates ────────────────── */
async function getGuestyToken(env) {
  if (!env.GUESTY_KV) {
    throw new Error('Worker missing GUESTY_KV binding — cannot persist Guesty token across isolates. Daily Guesty OAuth limit is 5/day; without KV we would exceed it. Add a KV namespace and bind as GUESTY_KV in Worker settings.');
  }
  if (!env.GUESTY_CLIENT_ID || !env.GUESTY_CLIENT_SECRET) {
    throw new Error('Worker missing GUESTY_CLIENT_ID / GUESTY_CLIENT_SECRET secret');
  }

  // 1. Hot-path: per-isolate memory hit. Saves a KV read.
  if (_localToken && _localTokenExp > Date.now() + 60_000) {
    return _localToken;
  }

  // 2. KV cache.
  const cachedRaw = await env.GUESTY_KV.get(KV_TOKEN_KEY);
  if (cachedRaw) {
    try {
      const { access_token, exp_ms } = JSON.parse(cachedRaw);
      if (access_token && exp_ms > Date.now() + 60_000) {
        _localToken    = access_token;
        _localTokenExp = exp_ms;
        return access_token;
      }
    } catch (_) { /* fall through to refresh */ }
  }

  // 3. Negative cache: if we know we're rate-limited, fail fast — DON'T retry.
  // This is the critical defence. Guesty allows 5 token fetches per day.
  // If we keep retrying when locked out, we keep the limit window alive.
  const backoffRaw = await env.GUESTY_KV.get(KV_BACKOFF_KEY);
  if (backoffRaw) {
    const until = Number(backoffRaw);
    if (until > Date.now()) {
      const sec = Math.round((until - Date.now()) / 1000);
      throw new Error(`Guesty OAuth rate-limited. Worker is backing off until ${new Date(until).toISOString()} (${sec}s remaining). No requests will be sent to Guesty during this window.`);
    }
  }

  // 4. Fetch a fresh token from Guesty.
  const tokenRes = await fetch('https://open-api.guesty.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     env.GUESTY_CLIENT_ID,
      client_secret: env.GUESTY_CLIENT_SECRET,
      scope:         'open-api',
    }),
  });

  if (tokenRes.status === 429) {
    // Guesty told us how long to wait. Honour it.
    const retryAfter = Number(tokenRes.headers.get('retry-after')) ||
                       Number(tokenRes.headers.get('ratelimit-reset')) ||
                       3600; // fallback: 1 hour
    const until = Date.now() + (retryAfter * 1000);
    await env.GUESTY_KV.put(KV_BACKOFF_KEY, String(until), {
      expirationTtl: Math.max(60, retryAfter + 60),
    });
    const txt = await tokenRes.text().catch(() => '');
    throw new Error(`Guesty token exchange rate-limited (429). Backing off for ${retryAfter}s until ${new Date(until).toISOString()}. ${txt.slice(0, 200)}`);
  }

  if (!tokenRes.ok) {
    const txt = await tokenRes.text().catch(() => '');
    throw new Error(`Guesty token exchange failed: ${tokenRes.status} ${txt.slice(0, 300)}`);
  }

  const j = await tokenRes.json();
  if (!j.access_token) {
    throw new Error('Guesty token exchange returned no access_token: ' + JSON.stringify(j).slice(0, 300));
  }

  const expSec  = Number(j.expires_in) || 86400;
  const exp_ms  = Date.now() + (expSec * 1000) - 60_000; // refresh 1 min early

  // Persist in KV with TTL matching the token lifetime. Once stored, every
  // future request — across all isolates, all colos — reuses this single
  // token until just before it expires.
  await env.GUESTY_KV.put(
    KV_TOKEN_KEY,
    JSON.stringify({ access_token: j.access_token, exp_ms }),
    { expirationTtl: Math.max(60, expSec - 60) },
  );

  // Clear any stale back-off marker now that we have a working token.
  await env.GUESTY_KV.delete(KV_BACKOFF_KEY).catch(() => {});

  _localToken    = j.access_token;
  _localTokenExp = exp_ms;
  return j.access_token;
}

/* ── Guesty: forward arbitrary path with our token attached ──────────────── */
async function proxyGuesty(request, env, url) {
  const token = await getGuestyToken(env);

  const upstreamPath = url.pathname.replace(/^\/guesty/, '') || '/';
  const upstreamUrl  = 'https://open-api.guesty.com' + upstreamPath + url.search;

  const init = {
    method:  request.method,
    headers: {
      'Authorization': 'Bearer ' + token,
      'Accept':        'application/json',
    },
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const ct = request.headers.get('Content-Type');
    if (ct) init.headers['Content-Type'] = ct;
    init.body = await request.arrayBuffer();
  }

  const r = await fetch(upstreamUrl, init);
  return new Response(await r.text(), {
    status: r.status,
    headers: { 'Content-Type': r.headers.get('Content-Type') || 'application/json' },
  });
}

/* ── CORS helpers ────────────────────────────────────────────────────────── */
function corsHeaders(origin) {
  const allowed = ALLOW_ORIGINS.includes(origin) ||
                  /\.workers\.dev$/.test(safeHost(origin)) ||
                  /\.be-here\.travel$/.test(safeHost(origin)) ||
                  /\.github\.io$/.test(safeHost(origin));
  return {
    'Access-Control-Allow-Origin':  allowed ? origin : ALLOW_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, API-Version, anthropic-version',
    'Access-Control-Max-Age':       '86400',
    'Vary':                         'Origin',
  };
}
function withCors(resp, origin) {
  if (!(resp instanceof Response)) {
    return new Response(JSON.stringify({
      error: 'withCors got non-Response: ' + (resp === null ? 'null' : typeof resp),
    }), { status: 500, headers: { 'Content-Type': 'application/json',
      ...corsHeaders(origin) } });
  }
  const headers = new Headers(resp.headers);
  for (const [k, v] of Object.entries(corsHeaders(origin))) headers.set(k, v);
  return new Response(resp.body, { status: resp.status, headers });
}
function safeHost(origin) {
  try { return new URL(origin).host; } catch (_) { return ''; }
}
function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
