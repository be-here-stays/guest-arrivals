/* ─────────────────────────────────────────────────────────────────────────
   Be Here — Property Checks shared schema helpers.

   Used by staff.html (maintenance role logs results on My Day) and a
   manager inbox (to be built). Mirrors the auto-discovery + idempotent
   bootstrap pattern from linens-schema, messages-schema, feedback-schema.

   Design:
   - Board name: "Be Here — Property Checks". Auto-discovered by name and
     cached in localStorage; bootstraps on first run if missing.
   - One row per (property × changeover date × check type). A row is
     created only when maintenance LOGS a check — pending state is
     derived virtually (property config flag set + no Done row for today
     = pending).
   - Two check types currently:
       Header tank   — heating system top-up check (Topped up / No action)
       Water softener — salt level check (Blocks count OR Balls kg)
   - Columns are typed so reporting can aggregate cleanly:
       Header action  — status: Topped up / No action
       Softener type  — status: Blocks / Balls
       Softener qty   — numeric (block count when Blocks, kg when Balls)
   ───────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const BOARD_NAME = 'Be Here — Property Checks';
  const CACHE_KEY  = 'bh.propertyChecksBoard';

  // Arrivals board id for the board_relation column. Hardcoded — every
  // Be Here tool already references this.
  const ARRIVALS_BOARD = '5094453064';
  const STAFF_BOARD    = '5095127554';

  const COLUMN_DEFS = [
    {
      key: 'type',
      title: 'Type',
      column_type: 'status',
      defaults: { labels: {
        '0':'Header tank',
        '1':'Water softener',
      }},
    },
    { key: 'property',    title: 'Property',         column_type: 'text' },
    { key: 'arrivalLink', title: 'Arrival',          column_type: 'board_relation' },
    { key: 'checkDate',   title: 'Check date',       column_type: 'date' },
    {
      key: 'status',
      title: 'Status',
      column_type: 'status',
      defaults: { labels: {
        '0':'Done',
        '1':'N/A',
        '2':'Skipped',
      }},
    },
    { key: 'performedAt',   title: 'Performed at', column_type: 'date' },
    { key: 'performedBy',   title: 'Performed by', column_type: 'text' },
    { key: 'performedByLink', title: 'Performed by (Staff)', column_type: 'board_relation' },
    // Header tank specific
    {
      key: 'headerAction',
      title: 'Header action',
      column_type: 'status',
      defaults: { labels: {
        '0':'Topped up',
        '1':'No action',
      }},
    },
    // Softener specific
    {
      key: 'softenerType',
      title: 'Softener type',
      column_type: 'status',
      defaults: { labels: {
        '0':'Blocks',
        '1':'Balls',
      }},
    },
    { key: 'softenerQty', title: 'Softener qty', column_type: 'numeric' },
    { key: 'notes',       title: 'Notes',        column_type: 'long_text' },
  ];

  // Two check types this schema currently supports. The flags on the
  // Property Config board that gate them are referenced by the consumer
  // pages (staff.html), but listed here for documentation.
  const CHECK_TYPES = [
    {
      key: 'header',
      label: 'Header tank',
      configFlag: 'boolean_mm372xj3',   // Property Config column id
      emoji: '🛢',
      actions: ['Topped up', 'No action'],
    },
    {
      key: 'softener',
      label: 'Water softener',
      configFlag: 'boolean_mm37e6gy',
      emoji: '🧂',
      saltTypes: ['Blocks', 'Balls'],
    },
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

  async function findChecksBoard(mq) {
    const data = await mq(`{
      boards(limit:500) {
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

  async function createChecksBoard(mq) {
    let boardId;
    const existingTitles = new Set();
    const existing = await findChecksBoard(mq);
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
      if (!boardId) throw new Error('Could not create Property Checks board');
    }

    for (const def of COLUMN_DEFS) {
      if (existingTitles.has(def.title.toLowerCase())) continue;
      let defaults = def.defaults;
      if (def.column_type === 'board_relation') {
        // Two board_relation columns: arrivalLink → Arrivals, performedByLink → Staff
        const target = def.key === 'performedByLink' ? STAFF_BOARD : ARRIVALS_BOARD;
        defaults = { boardIds: [parseInt(target, 10)] };
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

  async function getChecksConfig(mq) {
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
    const found = await findChecksBoard(mq);
    if (found) { writeCache(found); return found; }
    return null;
  }

  window.PropertyChecksSchema = {
    BOARD_NAME,
    ARRIVALS_BOARD,
    STAFF_BOARD,
    COLUMN_DEFS,
    CHECK_TYPES,
    getChecksConfig,
    createChecksBoard,
    findChecksBoard,
    clearCache,
  };
})();
