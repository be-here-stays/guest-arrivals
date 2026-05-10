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

  global.ArrivalsHelpers = {
    ARRIVALS_BOARD_ID,
    ARCHIVE_RE,
    isArchivedGroup,
    filterLive,
    partitionLive,
    groupQueryFragment,
    groupTitleOf,
  };

})(typeof window !== 'undefined' ? window : globalThis);
