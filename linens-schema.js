/* ─────────────────────────────────────────────────────────────────────────
   Be Here — Linen Issues shared schema helpers.

   Used by report-linen.html (staff submission form) and linen-inbox.html
   (manager triage queue). Mirrors the auto-discovery + idempotent bootstrap
   pattern from feedback-schema.js, leaves-schema.js, staff-schema.js.

   Design:
   - Board name: "Be Here — Linen Issues". Auto-discovered by name and
     cached in localStorage; bootstraps on first run if missing.
   - Each issue captures: category (Wrong bed config / Missing / Damaged /
     Wrong size), property name, booking ref, link to Arrivals row,
     expected vs found bed-config text (where relevant), missing/damaged
     item details (where relevant), reporter, submitted date, status,
     manager note, resolution date.
   - The Arrivals link is a board_relation column so the manager can hop
     straight to the booking record; the booking ref text gives a paper
     trail even if the relation drops.
   ───────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const BOARD_NAME = 'Be Here — Linen Issues';
  const CACHE_KEY  = 'bh.linensBoard';

  // Arrivals board id for the board_relation column. Hardcoded because
  // every Be Here tool already references this — no auto-discovery needed.
  const ARRIVALS_BOARD = '5094453064';

  const COLUMN_DEFS = [
    {
      key: 'category',
      title: 'Category',
      column_type: 'status',
      defaults: { labels: {
        '0':'Wrong bed config',
        '1':'Missing items',
        '2':'Damaged / stained',
        '3':'Wrong size or set',
        '4':'Other',
      }},
    },
    {
      key: 'status',
      title: 'Status',
      column_type: 'status',
      defaults: { labels: {
        '0':'New',
        '1':'In review',
        '2':'Actioned',
        '3':'Resolved',
        '4':"Won't fix",
      }},
    },
    { key: 'property',    title: 'Property',         column_type: 'text' },
    { key: 'bookingRef',  title: 'Booking ref',      column_type: 'text' },
    { key: 'arrivalLink', title: 'Booking',          column_type: 'board_relation' },
    { key: 'expected',    title: 'Expected',         column_type: 'long_text' },
    { key: 'found',       title: 'Found',            column_type: 'long_text' },
    { key: 'items',       title: 'Items affected',   column_type: 'long_text' },
    { key: 'reporter',    title: 'Reporter',         column_type: 'text' },
    { key: 'submitted',   title: 'Submitted',        column_type: 'date' },
    { key: 'mgrNote',     title: 'Manager note',     column_type: 'long_text' },
    { key: 'resolved',    title: 'Resolved',         column_type: 'date' },
  ];

  // Categories displayed by the form, in display order. Keep in sync with
  // the status column's default labels above.
  const CATEGORIES = [
    { key: 'Wrong bed config',  emoji: '🛏', desc: "Lodge set up differently from the booking's bed config." },
    { key: 'Missing items',     emoji: '⚠️', desc: 'Towels short, missing pillowcases, no duvet cover, etc.' },
    { key: 'Damaged / stained', emoji: '🩹', desc: 'Stains, tears, missing buttons.' },
    { key: 'Wrong size or set', emoji: '📐', desc: 'Wrong duvet size, mismatched towel set.' },
  ];

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

  async function findLinensBoard(mq) {
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

  /* Idempotent: if the board already exists by name, top up missing
     columns. Otherwise create the board + all columns. The board_relation
     column needs the connected board id at creation time — Monday accepts
     it via the `defaults` payload on most plans. */
  async function createLinensBoard(mq) {
    let boardId, existingTitles = new Set();
    const existing = await findLinensBoard(mq);
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
      if (!boardId) throw new Error('Could not create Linen Issues board');
    }

    for (const def of COLUMN_DEFS) {
      if (existingTitles.has(def.title.toLowerCase())) continue;
      // board_relation needs a defaults payload pointing at the connected
      // board. Status columns optionally get default labels.
      let defaults = def.defaults;
      if (def.column_type === 'board_relation') {
        defaults = { boardIds: [parseInt(ARRIVALS_BOARD, 10)] };
      }
      const defStr = defaults
        ? `, defaults: ${JSON.stringify(JSON.stringify(defaults))}`
        : '';
      try {
        await mq(`mutation {
          create_column(board_id: ${boardId}, title: "${def.title.replace(/"/g,'\\"')}", column_type: ${def.column_type}${defStr}) { id }
        }`);
      } catch (e) {
        if (defStr) {
          await mq(`mutation {
            create_column(board_id: ${boardId}, title: "${def.title.replace(/"/g,'\\"')}", column_type: ${def.column_type}) { id }
          }`);
        } else throw e;
      }
    }

    const refresh = await mq(`{ boards(ids:[${boardId}]) { id columns { id title type } } }`);
    const cols = refresh?.boards?.[0]?.columns || [];
    const result = { boardId, columns: resolveColumns(cols) };
    writeCache(result);
    return result;
  }

  async function getLinensConfig(mq) {
    const cached = readCache();
    if (cached && cached.boardId && cached.columns) {
      try {
        const ok = await mq(`{ boards(ids:[${cached.boardId}]) { id state columns { id title } } }`);
        const board = ok?.boards?.[0];
        if (board && board.state !== 'deleted') {
          cached.columns = resolveColumns(board.columns);
          writeCache(cached);
          return cached;
        }
      } catch (_) {}
    }
    const found = await findLinensBoard(mq);
    if (found) { writeCache(found); return found; }
    return null;
  }

  window.LinensSchema = {
    BOARD_NAME,
    ARRIVALS_BOARD,
    COLUMN_DEFS,
    CATEGORIES,
    getLinensConfig,
    createLinensBoard,
    findLinensBoard,
    clearCache,
  };
})();
