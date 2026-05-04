/* ─────────────────────────────────────────────────────────────────────────
   Be Here — App Feedback shared schema helpers.

   Used by report-feedback.html, feedback-inbox.html and any page that needs
   to read or write to the "App Feedback" Monday board. Other Be Here pages
   (staff.html, hub.html, etc.) just link to those two pages — they don't
   need to load this script.

   Design:
   - The board is auto-discovered by name on first load and cached in
     localStorage. If it doesn't exist yet, the helpers expose a one-shot
     bootstrap function that creates the board + the columns we need.
     (See createFeedbackBoard() below.) Column IDs are then read off the
     created board so we never have to hardcode opaque column ids.
   - All writes go through `mq()` which is supplied by the calling page so
     this file stays free of fetch + token logic. (Pages already have a
     proxy-aware fetch wrapper.)
   ───────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const BOARD_NAME = 'Be Here — App Feedback';
  const CACHE_KEY  = 'bh.feedbackBoard';   // cached { boardId, columns:{...} }

  // Column titles (and types) we'll create on first run, then resolve to
  // column ids on every load by reading the board's column list. Status
  // columns get sensible default labels so the user can use them right away.
  const COLUMN_DEFS = [
    {
      key: 'type',
      title: 'Type',
      column_type: 'status',
      defaults: { labels: { '0':'Bug', '1':'Enhancement' } },
    },
    {
      key: 'status',
      title: 'Status',
      column_type: 'status',
      defaults: { labels: { '0':'New', '1':'In review', '2':'Planned', '3':'In progress', '4':'Done', '5':"Won't fix" } },
    },
    {
      key: 'severity',
      title: 'Severity',
      column_type: 'status',
      defaults: { labels: { '0':'Low', '1':'Normal', '2':'High', '3':'Critical' } },
    },
    { key: 'page',        title: 'Page',                column_type: 'text' },
    { key: 'reporter',    title: 'Reporter',            column_type: 'text' },
    { key: 'description', title: 'Description',         column_type: 'long_text' },
    { key: 'steps',       title: 'Steps to reproduce',  column_type: 'long_text' },
    { key: 'submitted',   title: 'Submitted',           column_type: 'date' },
    { key: 'resolution',  title: 'Resolution / notes',  column_type: 'long_text' },
  ];

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

  /* Find the App Feedback board by name. Returns { boardId, columns } or
     null if not found. mq is the caller's GraphQL client. */
  async function findFeedbackBoard(mq) {
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

  /* Create the App Feedback board with all the expected columns. Returns
     { boardId, columns }. Should be guarded behind an admin button in the
     UI — running it twice will just create a second board with the same
     name. We try to detect that via findFeedbackBoard() before calling. */
  async function createFeedbackBoard(mq) {
    // 1. Create the board.
    const created = await mq(`mutation {
      create_board(board_name: "${BOARD_NAME.replace(/"/g,'\\"')}", board_kind: share) { id }
    }`);
    const boardId = created?.create_board?.id;
    if (!boardId) throw new Error('Could not create board');

    // 2. Create each column. Status columns ship with default labels so the
    //    board is immediately usable. Some Monday accounts reject the
    //    `defaults:` argument depending on plan — fall back to no defaults
    //    if needed; the user can name labels manually in Monday.
    for (const def of COLUMN_DEFS) {
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
    return { boardId, columns: resolveColumns(cols) };
  }

  /* High-level: get a usable config. Tries cache → live discovery →
     returns null if the board doesn't exist yet (caller can offer to
     bootstrap it via createFeedbackBoard). */
  async function getFeedbackConfig(mq) {
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
    const found = await findFeedbackBoard(mq);
    if (found) { writeCache(found); return found; }
    return null;
  }

  function clearCache() {
    try { localStorage.removeItem(CACHE_KEY); } catch (_) {}
  }

  // Expose on window so plain inline <script> blocks on each page can use
  // these. (Could be ESM but the rest of the codebase isn't.)
  window.FeedbackSchema = {
    BOARD_NAME,
    COLUMN_DEFS,
    getFeedbackConfig,
    createFeedbackBoard,
    findFeedbackBoard,
    clearCache,
  };
})();
