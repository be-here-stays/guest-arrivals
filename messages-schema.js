/* ─────────────────────────────────────────────────────────────────────────
   Be Here — Messages shared schema helpers.

   Used by messages.html (compose / inbox / sent / threads), and by
   staff.html (top-of-day MOTD render). Mirrors the auto-discovery +
   idempotent bootstrap pattern used by linens-schema, leaves-schema,
   feedback-schema and staff-schema.

   Design:
   - Board name: "Be Here — Messages". Auto-discovered by name and cached
     in localStorage; bootstraps on first run if missing.
   - Each message has:
       Body        (long text)
       Sender      (text — denormalised name for display)
       Sender ID   (board_relation → Staff — canonical author link)
       Audience    (status: All staff / Direct)
       Recipients  (board_relation → Staff — multi; empty for All)
       Posted at   (date with time)
       Expires at  (date — auto-hide after)
       Thread ID   (text — empty on root, set to root msg id on replies)
       Read by     (board_relation → Staff — multi; who's opened it)
       Dismissed by (board_relation → Staff — multi; who's hidden from My Day)
       Status      (status: Active / Withdrawn)
   - Threading is flat: every reply carries the same Thread ID as the root
     message. The root's Thread ID is empty (or its own item id, both
     handled). Reply UI groups by Thread ID.
   ───────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const BOARD_NAME = 'Be Here — Messages';
  const CACHE_KEY  = 'bh.messagesBoard';

  // Staff board id for the board_relation columns. Hardcoded because every
  // Be Here tool already references this — no auto-discovery needed.
  const STAFF_BOARD = '5095127554';

  const COLUMN_DEFS = [
    { key: 'body',        title: 'Body',          column_type: 'long_text' },
    { key: 'senderName',  title: 'Sender',        column_type: 'text' },
    { key: 'senderStaff', title: 'Sender ID',     column_type: 'board_relation' },
    {
      key: 'audience',
      title: 'Audience',
      column_type: 'status',
      defaults: { labels: { '0':'All staff', '1':'Direct' }},
    },
    { key: 'recipients',  title: 'Recipients',    column_type: 'board_relation' },
    { key: 'postedAt',    title: 'Posted at',     column_type: 'date' },
    { key: 'expiresAt',   title: 'Expires at',    column_type: 'date' },
    { key: 'threadId',    title: 'Thread ID',     column_type: 'text' },
    { key: 'readBy',      title: 'Read by',       column_type: 'board_relation' },
    { key: 'dismissedBy', title: 'Dismissed by',  column_type: 'board_relation' },
    {
      key: 'status',
      title: 'Status',
      column_type: 'status',
      defaults: { labels: { '0':'Active', '1':'Withdrawn' }},
    },
  ];

  // Audience labels mirror the status defaults — keep in sync.
  const AUDIENCES = [
    { key: 'All staff', desc: 'Every active staff member sees this on My Day.' },
    { key: 'Direct',    desc: 'Only the people you pick will see it.' },
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

  async function findMessagesBoard(mq) {
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

  /* Idempotent: if the board already exists by name, top up missing
     columns. Otherwise create the board + all columns. board_relation
     columns are connected to the Staff board on creation. */
  async function createMessagesBoard(mq) {
    let boardId;
    const existingTitles = new Set();
    const existing = await findMessagesBoard(mq);
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
      if (!boardId) throw new Error('Could not create Messages board');
    }

    for (const def of COLUMN_DEFS) {
      if (existingTitles.has(def.title.toLowerCase())) continue;
      let defaults = def.defaults;
      if (def.column_type === 'board_relation') {
        defaults = { boardIds: [parseInt(STAFF_BOARD, 10)] };
      }
      const defStr = defaults
        ? `, defaults: ${JSON.stringify(JSON.stringify(defaults))}`
        : '';
      try {
        await mq(`mutation {
          create_column(board_id: ${boardId}, title: "${def.title.replace(/"/g,'\\"')}", column_type: ${def.column_type}${defStr}) { id }
        }`);
      } catch (e) {
        // Retry without defaults — Monday on some plans rejects the
        // defaults arg for board_relation; the column still gets created
        // and the user can wire the link manually if needed.
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

  /* Hot-path lookup: cached config first; revalidate by checking the
     board still exists; if cache miss, do the slow board search. Returns
     null if no Messages board exists yet (caller should bootstrap). */
  async function getMessagesConfig(mq) {
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
    const found = await findMessagesBoard(mq);
    if (found) { writeCache(found); return found; }
    return null;
  }

  /* ── Convenience helpers used by messages.html and staff.html ───────────
     Filter / mutate operations live here so consumers don't repeat
     plumbing. Each helper takes the resolved config (boardId + columns)
     and the page's mq() function. */

  /* Should `me` (Staff item id) see this message?
     - Audience "All staff" → yes, unless explicitly dismissed.
     - Audience "Direct"    → yes if me is in recipients OR is the sender,
                              minus dismissed.
     Withdrawn / expired messages return false. */
  function visibleToStaff(msg, meStaffId, today) {
    if (!msg) return false;
    if (msg.status === 'Withdrawn') return false;
    if (msg.expiresAt && msg.expiresAt < today) return false;
    if ((msg.dismissedBy || []).map(String).includes(String(meStaffId))) return false;
    if (msg.audience === 'All staff') return true;
    // Direct
    if ((msg.recipients || []).map(String).includes(String(meStaffId))) return true;
    if (String(msg.senderStaffId) === String(meStaffId)) return true;
    return false;
  }

  function isUnreadFor(msg, meStaffId) {
    if (!msg) return false;
    if (String(msg.senderStaffId) === String(meStaffId)) return false; // I sent it
    return !((msg.readBy || []).map(String).includes(String(meStaffId)));
  }

  window.MessagesSchema = {
    BOARD_NAME,
    STAFF_BOARD,
    COLUMN_DEFS,
    AUDIENCES,
    getMessagesConfig,
    createMessagesBoard,
    findMessagesBoard,
    clearCache,
    visibleToStaff,
    isUnreadFor,
  };
})();
