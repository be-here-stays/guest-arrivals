/* ─────────────────────────────────────────────────────────────────────────
   Be Here — Leave Requests shared schema helpers.

   Used by request-leave.html (staff submission form) and leave-inbox.html
   (manager approval queue). Mirrors the pattern in feedback-schema.js:

   - The board is auto-discovered by name on first load and cached in
     localStorage. If it doesn't exist yet, the helpers expose a one-shot
     bootstrap function (createLeavesBoard) that creates the board + the
     columns we need. Column IDs are then resolved off the created board so
     we never have to hardcode opaque ids.
   - All Monday writes go through `mq()` supplied by the calling page so
     this file stays free of fetch + token logic.

   Workflow:
     1. Staff submits a request → row created with Status = "Pending".
     2. Manager opens leave-inbox → sees pending requests + a count of how
        many staff already have Off/Leave/Sick on each day in the range.
     3. If 2+ already off on any day in range, manager must tick the
        "Override" box before Approve unlocks. That tick lands in
        LV_OVERRIDE so the audit trail captures it.
     4. On Approve, the inbox writes Status = "Approved" + decided date,
        AND creates one row per day on the Staff Shifts board with the
        correct role (Annual leave/Personal → "Leave"; Sick day → "Sick").
        The rota planner picks those rows up automatically (it already
        treats {Off,Leave,Sick} as blocking).
   ───────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const BOARD_NAME = 'Be Here — Leave Requests';
  const CACHE_KEY  = 'bh.leavesBoard';   // cached { boardId, columns:{...} }

  // Column titles (and types) we'll create on first run, then resolve to
  // column ids on every load by reading the board's column list. Status
  // columns ship with default labels so the board is immediately usable.
  const COLUMN_DEFS = [
    {
      key: 'type',
      title: 'Type',
      column_type: 'status',
      defaults: { labels: { '0':'Annual leave', '1':'Sick day', '2':'Personal / unpaid' } },
    },
    {
      key: 'status',
      title: 'Status',
      column_type: 'status',
      defaults: { labels: { '0':'Pending', '1':'Approved', '2':'Declined', '3':'Cancelled' } },
    },
    { key: 'staffName',  title: 'Staff',          column_type: 'text' },
    { key: 'staffId',    title: 'Staff ID',       column_type: 'text' },
    { key: 'startDate',  title: 'Start',          column_type: 'date' },
    { key: 'endDate',    title: 'End',            column_type: 'date' },
    { key: 'days',       title: 'Days',           column_type: 'numbers' },
    { key: 'reason',     title: 'Reason',         column_type: 'long_text' },
    { key: 'mgrNote',    title: 'Manager note',   column_type: 'long_text' },
    { key: 'submitted',  title: 'Submitted',      column_type: 'date' },
    { key: 'decided',    title: 'Decided',        column_type: 'date' },
    { key: 'override',   title: 'Override used',  column_type: 'checkbox' },
  ];

  // Mapping from leave type to the role label written on the Staff Shifts
  // board when a request is approved. The rota planner treats {Off,Leave,
  // Sick} as blocking — Annual leave and Personal both map to "Leave" so
  // the rota shows a holiday block; Sick day maps to "Sick" so the cause
  // is visible to schedulers.
  const TYPE_TO_SHIFT_ROLE = {
    'Annual leave':       'Leave',
    'Sick day':           'Sick',
    'Personal / unpaid':  'Leave',
  };

  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (_) { return null; }
  }
  function writeCache(v) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(v)); } catch (_) {}
  }

  /* Resolve column IDs from a board's column list, matching by title.
     Missing columns are returned as null so the caller can prompt for a
     repair pass. */
  function resolveColumns(boardColumns) {
    const byTitle = {};
    for (const c of (boardColumns || [])) byTitle[(c.title || '').trim().toLowerCase()] = c.id;
    const out = {};
    for (const def of COLUMN_DEFS) {
      out[def.key] = byTitle[def.title.toLowerCase()] || null;
    }
    return out;
  }

  /* Find the Leave Requests board by name. Returns { boardId, columns } or
     null if not found. mq is the caller's GraphQL client. */
  async function findLeavesBoard(mq) {
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

  /* Create the Leave Requests board with all the expected columns. Returns
     { boardId, columns }.

     Idempotent: if a board with this name already exists (e.g. from a
     previous partial setup that errored mid-way), we re-use it and only
     create the columns that are missing. Safe to press the setup button
     repeatedly. */
  async function createLeavesBoard(mq) {
    // 1. Find or create the board.
    let boardId, existingTitles = new Set();
    const existing = await findLeavesBoard(mq);
    if (existing) {
      boardId = existing.boardId;
      // Re-read column titles so we know which ones are already present.
      const refresh = await mq(`{ boards(ids:[${boardId}]) { columns { id title type } } }`);
      const cols = refresh?.boards?.[0]?.columns || [];
      for (const c of cols) existingTitles.add((c.title || '').trim().toLowerCase());
    } else {
      const created = await mq(`mutation {
        create_board(board_name: "${BOARD_NAME.replace(/"/g,'\\"')}", board_kind: share) { id }
      }`);
      boardId = created?.create_board?.id;
      if (!boardId) throw new Error('Could not create board');
    }

    // 2. Create any columns that don't already exist. Status columns ship
    //    with default labels so the board is immediately usable. Some
    //    Monday accounts reject the `defaults:` argument depending on plan
    //    — fall back to no defaults if needed; the user can name labels
    //    manually in Monday.
    for (const def of COLUMN_DEFS) {
      if (existingTitles.has(def.title.toLowerCase())) continue;  // already there
      const defStr = def.defaults
        ? `, defaults: ${JSON.stringify(JSON.stringify(def.defaults))}`
        : '';
      try {
        await mq(`mutation {
          create_column(board_id: ${boardId}, title: "${def.title.replace(/"/g,'\\"')}", column_type: ${def.column_type}${defStr}) { id }
        }`);
      } catch (e) {
        // Retry without defaults if Monday rejected them.
        if (defStr) {
          await mq(`mutation {
            create_column(board_id: ${boardId}, title: "${def.title.replace(/"/g,'\\"')}", column_type: ${def.column_type}) { id }
          }`);
        } else throw e;
      }
    }

    // 3. Read the board back so we get the column IDs Monday assigned.
    const refresh = await mq(`{ boards(ids:[${boardId}]) { id columns { id title type } } }`);
    const cols = refresh?.boards?.[0]?.columns || [];
    const result = { boardId, columns: resolveColumns(cols) };
    writeCache(result);
    return result;
  }

  /* High-level: get a usable config. Tries cache → live discovery →
     returns null if the board doesn't exist yet (caller can offer to
     bootstrap it via createLeavesBoard). */
  async function getLeavesConfig(mq) {
    // 1. Cache first — keeps page loads fast.
    const cached = readCache();
    if (cached && cached.boardId && cached.columns) {
      // Quick sanity check: confirm the board still exists.
      try {
        const ok = await mq(`{ boards(ids:[${cached.boardId}]) { id state columns { id title } } }`);
        const board = ok?.boards?.[0];
        if (board && board.state !== 'deleted') {
          // Refresh column IDs in case any were renamed/added.
          cached.columns = resolveColumns(board.columns);
          writeCache(cached);
          return cached;
        }
      } catch (_) { /* fall through to discovery */ }
    }
    // 2. Live discovery.
    const found = await findLeavesBoard(mq);
    if (found) { writeCache(found); return found; }
    return null;
  }

  function clearCache() {
    try { localStorage.removeItem(CACHE_KEY); } catch (_) {}
  }

  /* ── Helpers shared between submit form and inbox ─────────────────────── */

  /* Enumerate every day between two ISO dates (inclusive), returns
     ['YYYY-MM-DD', ...]. Handles same-day (returns single entry). */
  function daysInRange(startISO, endISO) {
    if (!startISO) return [];
    const out = [];
    const cur = new Date(startISO + 'T12:00:00');
    const end = new Date((endISO || startISO) + 'T12:00:00');
    while (cur <= end) {
      out.push(cur.toISOString().split('T')[0]);
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }

  /* Given a list of Staff Shifts rows (with .date and .role), return a Map
     keyed by date → count of staff with role in {Off, Leave, Sick}. The
     conflict warning shows when any day has count >= 2 (because adding a
     third would tip it to 3). */
  const BLOCKING_ROLES = new Set(['Off', 'Leave', 'Sick']);
  function countBlockingByDay(shiftRows) {
    const out = new Map();
    for (const r of (shiftRows || [])) {
      if (!r || !r.date || !r.role) continue;
      if (!BLOCKING_ROLES.has(r.role)) continue;
      out.set(r.date, (out.get(r.date) || 0) + 1);
    }
    return out;
  }

  /* For a candidate leave range, look up how many staff are already off on
     each day. Returns an array of { date, count } in date order, plus a
     boolean .conflict if any day has count >= 2. */
  function conflictCheck(rangeDays, blockingByDay) {
    const days = rangeDays.map(d => ({ date: d, count: blockingByDay.get(d) || 0 }));
    return {
      days,
      conflict: days.some(d => d.count >= 2),
      worstCount: days.reduce((m, d) => Math.max(m, d.count), 0),
    };
  }

  // Expose on window so plain inline <script> blocks on each page can use
  // these. (Could be ESM but the rest of the codebase isn't.)
  window.LeavesSchema = {
    BOARD_NAME,
    COLUMN_DEFS,
    TYPE_TO_SHIFT_ROLE,
    BLOCKING_ROLES,
    getLeavesConfig,
    createLeavesBoard,
    findLeavesBoard,
    clearCache,
    daysInRange,
    countBlockingByDay,
    conflictCheck,
  };
})();
