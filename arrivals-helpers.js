/* ─────────────────────────────────────────────────────────────────────────
   arrivals-helpers.js — single source of truth for "what counts as a live
   Arrivals row" across every page that reads the Arrivals board.

   The Arrivals board groups items into "Upcoming Arrivals", "Archive",
   "Cancelled" etc. Items moved to archive groups must NOT appear on
   downstream rotas, recon tools, or staff My Day views — but pages that
   pulled items_page without filtering by group were drawing them anyway.
   This helper centralises the filter so every page applies the same rule
   and the regex can't drift between files.

   Usage on any page that loads Arrivals:

     // 1. Include in the items_page query so we can read item.group.title
     //    items {
     //      id name
     //      group { id title }      ← REQUIRED
     //      column_values(...) { ... }
     //    }
     //
     // 2. After parsing the response:
     //    const live = ArrivalsHelpers.filterLive(items);
     //
     // Or, if you want both the live list AND a count of what was filtered
     // for diagnostics:
     //    const { live, archived, archivedByGroup } =
     //      ArrivalsHelpers.partitionLive(items);

   The regex is intentionally permissive to catch typos and variations:
     "Archive", "archived", "Cancelled", "Cancelled bookings", "ARCHIVE" etc.
   If you ever introduce a deliberately-named group that contains one of
   those words but should NOT be excluded (e.g. "Pending archive"), pass
   `{ allow: ['Pending archive'] }` to opt that group back in.
   ───────────────────────────────────────────────────────────────────────── */

(function (global) {
  'use strict';

  const ARRIVALS_BOARD_ID = '5094453064';

  // Permissive match — case-insensitive, word-boundary anchored, accepts
  // both UK ("cancelled") and US ("canceled") spellings.
  const ARCHIVE_RE = /\b(archive|archived|cancell?ed)\b/i;

  function groupTitleOf(item) {
    return (item && item.group && item.group.title) ? String(item.group.title) : '';
  }

  function isArchivedGroup(item, opts) {
    const title = groupTitleOf(item).trim();
    if (!title) return false;
    const allow = (opts && Array.isArray(opts.allow)) ? opts.allow : [];
    if (allow.some(a => a && a.toLowerCase() === title.toLowerCase())) return false;
    return ARCHIVE_RE.test(title);
  }

  /* Returns only items that are NOT in an archive-named group. */
  function filterLive(items, opts) {
    if (!Array.isArray(items)) return [];
    return items.filter(it => !isArchivedGroup(it, opts));
  }

  /* Returns { live, archived, archivedByGroup } so callers can show a
     diagnostic of what got skipped. archivedByGroup is { groupTitle: count }. */
  function partitionLive(items, opts) {
    const live = [], archived = [], archivedByGroup = {};
    if (!Array.isArray(items)) return { live, archived, archivedByGroup };
    for (const it of items) {
      if (isArchivedGroup(it, opts)) {
        archived.push(it);
        const t = groupTitleOf(it).trim() || '(unknown group)';
        archivedByGroup[t] = (archivedByGroup[t] || 0) + 1;
      } else {
        live.push(it);
      }
    }
    return { live, archived, archivedByGroup };
  }

  /* Convenience: GraphQL fragment to drop into items_page queries.
     Returns the literal string `group { id title }` so callers can
     concatenate it without thinking. */
  function groupQueryFragment() {
    return 'group { id title }';
  }

  /* ── Active-group lookup ─────────────────────────────────────────────
     Returns the id of the first non-archive group on the Arrivals board
     so create_item can be aimed at it explicitly. Without this, Monday
     puts the new row in some default group — which has been observed
     putting newly-created rows into the Archive group itself, with the
     result that a freshly-"created" row immediately gets filtered out
     by filterLive and the recon keeps flagging it as missing.

     Cached in localStorage so first run hits Monday once, subsequent
     runs reuse. Pass `forceRefresh:true` if you suspect the group id has
     changed (board renamed, group deleted etc).

     `mq` is the page's Monday GraphQL helper — same shape as everywhere
     else, takes a query string and returns the parsed `data` object. */
  const ACTIVE_GROUP_CACHE_KEY = 'bh.arrivals.liveGroupId';

  async function getLiveGroupId(mq, opts) {
    const force = !!(opts && opts.forceRefresh);
    if (!force) {
      try {
        const cached = localStorage.getItem(ACTIVE_GROUP_CACHE_KEY);
        if (cached) return cached;
      } catch (_) {}
    }

    const data = await mq(`{
      boards(ids:[${ARRIVALS_BOARD_ID}]) {
        groups { id title archived deleted }
      }
    }`);
    const groups = (data?.boards?.[0]?.groups || []).filter(g => !g.archived && !g.deleted);
    // Pick the first group whose title is NOT archive-named. This is the
    // top-most live group on the board, which is where the team adds new
    // bookings by default.
    const live = groups.find(g => !ARCHIVE_RE.test(g.title || ''));
    if (!live) {
      throw new Error('No live group found on Arrivals board (every group looks archived). Check the Arrivals board on Mondays.');
    }
    try { localStorage.setItem(ACTIVE_GROUP_CACHE_KEY, live.id); } catch (_) {}
    return live.id;
  }

  global.ArrivalsHelpers = {
    ARRIVALS_BOARD_ID,
    ARCHIVE_RE,
    isArchivedGroup,
    filterLive,
    partitionLive,
    groupQueryFragment,
    groupTitleOf,
    getLiveGroupId,
  };

})(typeof window !== 'undefined' ? window : globalThis);
