// Be Here Stays — Service Worker
// Caches app shell for fast loading and offline UI.
// Monday.com API calls are always fetched from the network.

const CACHE    = 'be-here-v51';
const PRECACHE = [
  '/guest-arrivals/hub.html',
  '/guest-arrivals/index.html',
  '/guest-arrivals/arrivals-hub.html',
  '/guest-arrivals/supplies-field.html',
  '/guest-arrivals/stock.html',
  '/guest-arrivals/changeover-form.html',
  '/guest-arrivals/delivery-report.html',
  '/guest-arrivals/window-cleaning.html',
  '/guest-arrivals/jet-washing.html',
  '/guest-arrivals/pat-testing.html',
  '/guest-arrivals/hot-tub.html',
  '/guest-arrivals/waiver.html',
  '/guest-arrivals/linen-returns.html',
  '/guest-arrivals/linen-stock.html',
  '/guest-arrivals/laundry-rota.html',
  '/guest-arrivals/laundry-run.html',
  '/guest-arrivals/checker.html',
  '/guest-arrivals/rota-planner.html',
  '/guest-arrivals/staff-shifts.html',
  '/guest-arrivals/staff.html',
  '/guest-arrivals/payroll.html',
  '/guest-arrivals/work-dispatch.js',
  '/guest-arrivals/manifest.json',
  '/guest-arrivals/icon.svg',
  '/guest-arrivals/icon-192.png',
  '/guest-arrivals/icon-512.png',
];

// Install: cache the app shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch strategy:
//   • Monday API + fonts            → always network
//   • HTML pages (navigation)       → network-first, cache fallback
//   • Static assets (JS, icons …)   → cache-first
//
// 2026-05-14 — Switched HTML from cache-first to network-first. The old
// strategy was freezing hub.html (and other pages) at the version cached
// during the SW install, so menu items added later (Guesty sync, Staff
// Records, Linen Inbox, PIN Admin, Leave Inbox, the Linen Low/Out KPI…)
// only appeared after a hard refresh, then vanished again on the next
// soft navigation. Network-first means the freshest HTML wins every
// time the network is up; offline still falls back to the cached copy.
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Always hit the network for Monday API & fonts — explicit passthrough
  // (Safari PWAs sometimes mangle `return;` without respondWith, so we proxy explicitly)
  if (url.includes('api.monday.com') || url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Network-first for HTML so menu/page updates land immediately.
  // Detect HTML by request mode (top-level navigation) OR destination
  // ('document') OR the URL ending in .html. Falls back to cache when
  // offline so the app keeps loading.
  const isHtml = e.request.mode === 'navigate'
    || e.request.destination === 'document'
    || /\.html(\?|$)/i.test(url);
  if (isHtml) {
    e.respondWith(
      fetch(e.request).then(response => {
        if (response && response.status === 200 && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache-first for static assets (JS, icons, manifest, etc.)
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (response && response.status === 200 && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => cached); // offline fallback to cache
    })
  );
});
