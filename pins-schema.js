/* ─────────────────────────────────────────────────────────────────────────
   Be Here — Per-area PIN registry.

   Used by every gated manager page (rota-planner, hot-tub-rota,
   laundry-rota, staff-shifts, staff-records, leave-inbox, pin-admin) and
   the admin page that sets PINs (pin-admin.html).

   Design:
   - One Monday board ('Be Here — Access PINs') with one row per area. Each
     row stores a SHA-256 hex hash of the area's PIN, plus metadata about
     when/who changed it. PINs themselves never hit the network — hashing
     is done client-side.
   - Auto-discovers the board by name + bootstraps it with all known areas
     pre-seeded with the LEGACY hash (652318) so day-1 nothing breaks.
   - Each area has its own sessionStorage key so unlocking the rota planner
     does NOT auto-grant access to staff records, leave inbox, etc. A
     manager who works across several tools will type a PIN per tool per
     session — but the trade-off is real per-area access control.
   - Graceful fallback: if the board can't be loaded (network blip, or the
     bootstrap hasn't been run yet), `checkPin` falls back to the LEGACY
     hash so nobody gets locked out during migration.
   ───────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const BOARD_NAME = 'Be Here — Access PINs';
  const CACHE_KEY  = 'bh.pinsBoard';     // cached { boardId, columns:{...}, pins:{areaKey:hash} }
  const SESSION_PREFIX = 'bh.pin.';       // sessionStorage prefix per area
  const CACHE_TTL_MS = 60 * 60 * 1000;    // pins map refresh — 1 hour

  // The legacy PIN hash (SHA-256 of "652318"). All consumers used this
  // before the registry existed; it's our default fallback so migration
  // doesn't lock anyone out before the manager has visited pin-admin.
  const LEGACY_HASH = 'df8d602b7bcaf41725409b83af2a3df79722be244d9f33b5f128b81a269b955e';

  // The set of areas the registry knows about. New consumer pages should
  // add themselves here. The bootstrap creates one board row per area,
  // pre-seeded with the legacy hash. Order is the order shown in the
  // admin UI.
  const AREAS = [
    { key: 'rota-planner',   title: 'Rota planner',  description: 'Cleans rota — read/write, send day, save day sheets.' },
    { key: 'hot-tub-rota',   title: 'Hot tub rota',  description: 'Hot tub maintenance scheduling.' },
    { key: 'laundry-rota',   title: 'Laundry rota',  description: 'Linen pickups + drops.' },
    { key: 'staff-shifts',   title: 'Staff shifts',  description: 'Weekly hours matrix; payroll inputs.' },
    { key: 'staff-records',  title: 'Staff records', description: 'Personal data (DOB, NoK, address) and leave entitlement.' },
    { key: 'leave-inbox',    title: 'Leave inbox',   description: 'Approve / decline staff leave requests.' },
    { key: 'linen-inbox',    title: 'Linen inbox',   description: 'Triage bedding / missing-item / damage reports from the team.' },
    { key: 'pin-admin',      title: 'PIN admin',     description: 'Super-admin only — manage area PINs from this page.' },
  ];

  // Columns the board needs. Same idempotent setup pattern as
  // feedback-schema / leaves-schema / staff-schema.
  const COLUMN_DEFS = [
    { key: 'areaKey',     title: 'Area key',       column_type: 'text' },
    { key: 'description', title: 'Description',    column_type: 'long_text' },
    { key: 'pinHash',     title: 'Hash',           column_type: 'text' },
    { key: 'lastChanged', title: 'Last changed',   column_type: 'date' },
    { key: 'changedBy',   title: 'Last changed by',column_type: 'text' },
  ];

  /* ── Tiny utilities ────────────────────────────────────────────────── */
  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text || ''));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  }
  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (_) { return null; }
  }
  function writeCache(v) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(v)); } catch (_) {}
  }
  function clearCache() {
    try { localStorage.removeItem(CACHE_KEY); } catch (_) {}
  }
  function resolveColumns(boardColumns) {
    const byTitle = {};
    for (const c of (boardColumns || [])) byTitle[(c.title || '').trim().toLowerCase()] = c.id;
    const out = {};
    for (const def of COLUMN_DEFS) out[def.key] = byTitle[def.title.toLowerCase()] || null;
    return out;
  }

  /* ── Board discovery + bootstrap ────────────────────────────────────── */
  async function findPinsBoard(mq) {
    const data = await mq(`{
      boards(limit:200) {
        id name state
        columns { id title type }
      }
    }`);
    const board = (data?.boards || []).find(b =>
      b.state !== 'deleted'
      && (b.name || '').trim().toLowerCase() === BOARD_NAME.toLowerCase()
    );
    if (!board) return null;
    return { boardId: board.id, columns: resolveColumns(board.columns) };
  }

  /* Create the Pins board (or top up missing columns on an existing one)
     and seed every known area with the legacy hash. Idempotent: re-running
     skips areas that already have a row. Returns { boardId, columns }. */
  async function createPinsBoard(mq) {
    let boardId, existingTitles = new Set();
    const existing = await findPinsBoard(mq);
    if (existing) {
      boardId = existing.boardId;
      const refresh = await mq(`{ boards(ids:[${boardId}]) { columns { id title type } } }`);
      const cols = refresh?.boards?.[0]?.columns || [];
      for (const c of cols) existingTitles.add((c.title || '').trim().toLowerCase());
    } else {
      const created = await mq(`mutation {
        create_board(board_name: "${BOARD_NAME.replace(/"/g,'\\"')}", board_kind: share) { id }
      }`);
      boardId = created?.create_board?.id;
      if (!boardId) throw new Error('Could not create Pins board');
    }

    // Add any missing columns.
    for (const def of COLUMN_DEFS) {
      if (existingTitles.has(def.title.toLowerCase())) continue;
      await mq(`mutation {
        create_column(board_id: ${boardId}, title: "${def.title.replace(/"/g,'\\"')}", column_type: ${def.column_type}) { id }
      }`);
    }

    // Refresh column IDs.
    const refresh = await mq(`{ boards(ids:[${boardId}]) { items_page(limit: 200) { items { id name } } columns { id title type } } }`);
    const cols = resolveColumns(refresh?.boards?.[0]?.columns || []);
    const existingItems = refresh?.boards?.[0]?.items_page?.items || [];
    const existingNames = new Set(existingItems.map(i => (i.name || '').trim().toLowerCase()));

    // Seed any missing area rows with the legacy hash.
    const today = new Date().toISOString().slice(0,10);
    for (const area of AREAS) {
      const itemName = `${area.title} (${area.key})`;
      if (existingNames.has(itemName.toLowerCase())) continue;
      const cv = JSON.stringify({
        [cols.areaKey]:     area.key,
        [cols.description]: area.description,
        [cols.pinHash]:     LEGACY_HASH,
        [cols.lastChanged]: { date: today },
        [cols.changedBy]:   'Bootstrap',
      });
      await mq(
        `mutation($b:ID!,$n:String!,$v:JSON!){ create_item(board_id:$b, item_name:$n, column_values:$v){ id } }`,
        { b: boardId, n: itemName, v: cv }
      );
    }

    const result = await loadPinsImpl(mq, boardId, cols);
    writeCache(result);
    return result;
  }

  /* Read every Pins row → return { boardId, columns, pins:{areaKey:hash}, ts } */
  async function loadPinsImpl(mq, boardId, cols) {
    const colsArg = [cols.areaKey, cols.pinHash].filter(Boolean).map(c => `"${c}"`).join(',');
    const data = await mq(`{
      boards(ids:[${boardId}]) {
        items_page(limit:200) {
          items { id name column_values(ids:[${colsArg}]) { id text value } }
        }
      }
    }`);
    const items = data?.boards?.[0]?.items_page?.items || [];
    const pins = {};
    for (const it of items) {
      const cv = Object.fromEntries((it.column_values || []).map(c => [c.id, c]));
      const key = (cv[cols.areaKey]?.text || '').trim();
      const hash = (cv[cols.pinHash]?.text || '').trim();
      if (key && hash) pins[key] = hash;
    }
    return { boardId, columns: cols, pins, ts: Date.now() };
  }

  /* High-level: get the cached pins map. Refreshes from Monday when cache
     is older than CACHE_TTL_MS. Returns null if no board exists yet. */
  async function loadPins(mq) {
    const cached = readCache();
    const fresh = cached && (Date.now() - (cached.ts || 0) < CACHE_TTL_MS);
    if (fresh) return cached;
    try {
      const found = await findPinsBoard(mq);
      if (!found) return null;
      const result = await loadPinsImpl(mq, found.boardId, found.columns);
      writeCache(result);
      return result;
    } catch (e) {
      // Network or auth blip — return whatever we cached, or null. Consumers
      // fall back to the legacy hash, so users don't get locked out.
      return cached || null;
    }
  }

  /* Per-area session helpers. */
  function isUnlocked(areaKey) {
    return sessionStorage.getItem(SESSION_PREFIX + areaKey) === '1';
  }
  function unlockArea(areaKey) {
    sessionStorage.setItem(SESSION_PREFIX + areaKey, '1');
  }
  function lockArea(areaKey) {
    sessionStorage.removeItem(SESSION_PREFIX + areaKey);
  }
  function lockAll() {
    for (const a of AREAS) lockArea(a.key);
  }

  /* Verify a typed PIN against the registered hash for an area. Returns
     true on match (and writes the per-area session flag). Falls back to
     the legacy hash when the registry isn't available, OR when the area
     is unregistered (so adding a new area before the next bootstrap
     doesn't lock anyone out). */
  async function checkPin(mq, areaKey, value) {
    const hash = await sha256(value);
    let registry = null;
    try { registry = await loadPins(mq); } catch (_) {}
    const stored = registry?.pins?.[areaKey];
    if (stored) {
      // Area is registered — only the stored hash works. (Legacy is
      // rejected once a manager has explicitly set this area's PIN.)
      if (hash === stored) { unlockArea(areaKey); return true; }
      return false;
    }
    // Fallback: registry unreachable OR area not registered yet → legacy.
    if (hash === LEGACY_HASH) { unlockArea(areaKey); return true; }
    return false;
  }

  /* Manager-side: set a new PIN for an area. Hashes client-side, writes
     to Monday, refreshes the cache. `changedBy` is a free-text label
     (e.g. the manager's name). */
  async function setPin(mq, areaKey, newPinValue, changedBy) {
    const found = await findPinsBoard(mq);
    if (!found) throw new Error('Pins board not set up yet — run bootstrap first.');
    const cols = found.columns;
    if (!cols.areaKey || !cols.pinHash) throw new Error('Pins board is missing required columns — run bootstrap to top them up.');

    // Locate the row for this area.
    const data = await mq(`{
      boards(ids:[${found.boardId}]) {
        items_page(limit:200) {
          items { id column_values(ids:["${cols.areaKey}"]) { id text } }
        }
      }
    }`);
    const items = data?.boards?.[0]?.items_page?.items || [];
    const hit = items.find(it => {
      const cv = it.column_values?.find(c => c.id === cols.areaKey);
      return (cv?.text || '').trim() === areaKey;
    });
    if (!hit) throw new Error('Area "' + areaKey + '" not registered on the Pins board. Run bootstrap to seed missing rows.');

    const hash = await sha256(newPinValue);
    const today = new Date().toISOString().slice(0,10);
    const cv = JSON.stringify({
      [cols.pinHash]:     hash,
      [cols.lastChanged]: { date: today },
      [cols.changedBy]:   changedBy || '',
    });
    await mq(
      `mutation($i:ID!,$v:JSON!){ change_multiple_column_values(board_id:${found.boardId}, item_id:$i, column_values:$v){ id } }`,
      { i: hit.id, v: cv }
    );
    // Invalidate cache so the next checkPin call re-reads.
    clearCache();
    return true;
  }

  // Expose on window for plain inline scripts.
  window.PinsSchema = {
    BOARD_NAME,
    LEGACY_HASH,
    AREAS,
    sha256,
    isUnlocked,
    unlockArea,
    lockArea,
    lockAll,
    checkPin,
    setPin,
    loadPins,
    findPinsBoard,
    createPinsBoard,
    clearCache,
  };
})();
