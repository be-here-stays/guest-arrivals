/* ─────────────────────────────────────────────────────────────────────────
   Be Here — Staff Records shared schema helpers.

   Used by staff-records.html (manager view) and my-profile.html (staff
   self-service). Centralises the Staff board's column IDs in one place
   and exposes an idempotent setup helper that adds any missing HR-style
   columns to the existing Staff board (5095127554).

   Design:
   - Existing columns (ST_ROLE, ST_STATUS, ST_CONTRACT, ST_DEFRATE,
     ST_CODE, ST_EMAIL) are hardcoded — they're referenced from many
     other files (staff-shifts, rota-planner, staff.html, hot-tub-rota)
     and we don't want to break them.
   - New columns are auto-discovered by title with a setup helper that
     creates missing ones. Mirrors the feedback-schema / leaves-schema
     pattern. The resulting column IDs are cached in localStorage so
     subsequent page loads are fast.
   ───────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const STAFF_BOARD = '5095127554';
  const CACHE_KEY   = 'bh.staffSchema';   // cached { boardId, newColumns:{...} }

  // Existing columns — already on the Staff board, referenced by many files.
  const EXISTING = {
    ST_ROLE:     'color_mm2psadz',     // Primary role (single-status — kept as-is for backward compat)
    ST_STATUS:   'color_mm2psvh2',     // Active / On leave / Inactive (legacy)
    ST_CONTRACT: 'numeric_mm2pc978',   // Contract hours per week (existing)
    ST_DEFRATE:  'numeric_mm2p4pme',   // Default hourly rate (existing)
    ST_CODE:     'text_mm2qd59j',      // 4-digit staff login code
    ST_EMAIL:    'email_mm2pa071',
  };

  // Existing primary-role labels — used to seed the new "Roles" multi-select.
  const PRIMARY_ROLE_LABELS = ['Housekeeper','A Team','Checker','Van driver','Maintenance','Manager','Owner'];

  // New columns to provision. Type values use Monday's enum names (status,
  // text, long_text, date, numbers, dropdown, checkbox, phone). Status and
  // dropdown columns get default labels so the board is usable immediately.
  const NEW_COLUMN_DEFS = [
    // ── Identity (manager-only edit) ──────────────────────────────────────
    { key: 'dob',           title: 'Date of birth',   column_type: 'date' },
    { key: 'serviceStart',  title: 'Service start',   column_type: 'date' },
    { key: 'employmentType',title: 'Employment type', column_type: 'status',
      defaults: { labels: { '0':'Employed', '1':'Self-employed', '2':'Casual' } } },

    // ── Contact (staff self-edit) ─────────────────────────────────────────
    { key: 'mobile',        title: 'Mobile',          column_type: 'text' },
    { key: 'mobileAlt',     title: 'Mobile (alt)',    column_type: 'text' },
    { key: 'addr1',         title: 'Address line 1',  column_type: 'text' },
    { key: 'addr2',         title: 'Address line 2',  column_type: 'text' },
    { key: 'town',          title: 'Town',            column_type: 'text' },
    { key: 'postcode',      title: 'Postcode',        column_type: 'text' },

    // ── Next of kin (staff self-edit) ─────────────────────────────────────
    { key: 'nokName',       title: 'NoK name',          column_type: 'text' },
    { key: 'nokRelation',   title: 'NoK relationship',  column_type: 'text' },
    { key: 'nokPhone',      title: 'NoK phone',         column_type: 'text' },

    // ── Health (staff self-edit) ──────────────────────────────────────────
    { key: 'medical',       title: 'Allergies / medical', column_type: 'long_text' },
    { key: 'gpDetails',     title: 'GP details',          column_type: 'long_text' },

    // ── Role & rota (manager-only) ────────────────────────────────────────
    // Multi-select Roles — supports staff who can cover multiple jobs
    // (Housekeeper + Checker, etc.). Eligibility checks elsewhere will
    // intersect this set. Seeded from the primary Role label on first
    // setup so existing data isn't lost.
    { key: 'rolesAll',      title: 'Roles',           column_type: 'dropdown',
      defaults: { settings: { labels: PRIMARY_ROLE_LABELS.map((name, i) => ({ id: i+1, name })) } } },
    { key: 'stdHoursDay',   title: 'Std hours/day',   column_type: 'numbers' },

    // ── Leave entitlement (manager-only) ──────────────────────────────────
    { key: 'leaveEntitle',  title: 'Leave entitlement (h)', column_type: 'numbers' },
    { key: 'leaveYearStart',title: 'Leave year start',      column_type: 'date' },
    { key: 'leaveCarryOver',title: 'Carry-over (h)',        column_type: 'numbers' },

    // ── Preferences (staff self-edit) ─────────────────────────────────────
    { key: 'prefDays',      title: 'Preferred days',  column_type: 'dropdown',
      defaults: { settings: { labels: [
        { id: 1, name: 'Mon' }, { id: 2, name: 'Tue' }, { id: 3, name: 'Wed' },
        { id: 4, name: 'Thu' }, { id: 5, name: 'Fri' }, { id: 6, name: 'Sat' }, { id: 7, name: 'Sun' },
      ] } } },
    { key: 'earliestStart', title: 'Earliest start',  column_type: 'text' },
    { key: 'latestFinish',  title: 'Latest finish',   column_type: 'text' },
    { key: 'maxHoursWeek',  title: 'Max hours/wk',    column_type: 'numbers' },
    { key: 'unavailable',   title: 'Recurring unavailability', column_type: 'long_text' },
    { key: 'prefNotes',     title: 'Preferences notes', column_type: 'long_text' },

    // ── Practical (staff self-edit) ───────────────────────────────────────
    { key: 'drivingLicence',title: 'Driving licence', column_type: 'checkbox' },
    { key: 'ownVehicle',    title: 'Own vehicle',     column_type: 'checkbox' },

    // ── Manager-only notes ────────────────────────────────────────────────
    { key: 'mgrNotes',      title: 'Manager notes',   column_type: 'long_text' },
    { key: 'lastReview',    title: 'Last review',     column_type: 'date' },
    { key: 'dbsStatus',     title: 'DBS status',      column_type: 'status',
      defaults: { labels: { '0':'Pending', '1':'Cleared', '2':'Expired', '3':'N/A' } } },
    { key: 'dbsDate',       title: 'DBS date',        column_type: 'date' },
    { key: 'trainingCerts', title: 'Training certs',  column_type: 'long_text' },
  ];

  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (_) { return null; }
  }
  function writeCache(v) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(v)); } catch (_) {}
  }

  /* Resolve newly-added column IDs from a board's column list, matching
     by title. Missing columns are returned as null so the caller can
     prompt for a setup pass. */
  function resolveNewColumns(boardColumns) {
    const byTitle = {};
    for (const c of (boardColumns || [])) byTitle[(c.title || '').trim().toLowerCase()] = c.id;
    const out = {};
    for (const def of NEW_COLUMN_DEFS) {
      out[def.key] = byTitle[def.title.toLowerCase()] || null;
    }
    return out;
  }

  /* Read the Staff board's column list, return resolved IDs for the new
     columns. Returns { boardId, newColumns:{...}, missing:[...] }. */
  async function getStaffConfig(mq) {
    // Cache short-circuit when every column is already resolved.
    const cached = readCache();
    if (cached && cached.boardId && cached.newColumns) {
      const allResolved = NEW_COLUMN_DEFS.every(def => !!cached.newColumns[def.key]);
      if (allResolved) {
        // Quick sanity check that the board still exists.
        try {
          const ok = await mq(`{ boards(ids:[${cached.boardId}]) { id state } }`);
          if (ok?.boards?.[0] && ok.boards[0].state !== 'deleted') return { ...cached, missing: [] };
        } catch (_) { /* fall through */ }
      }
    }
    // Live read.
    const data = await mq(`{ boards(ids:[${STAFF_BOARD}]) { id columns { id title type } } }`);
    const board = data?.boards?.[0];
    if (!board) throw new Error('Staff board not found');
    const newColumns = resolveNewColumns(board.columns);
    const missing = NEW_COLUMN_DEFS.filter(def => !newColumns[def.key]).map(def => def.title);
    const result = { boardId: STAFF_BOARD, existing: EXISTING, newColumns, missing };
    if (!missing.length) writeCache(result);
    return result;
  }

  /* Idempotently add any missing columns to the Staff board. Safe to
     re-run — existing columns (matched by title) are skipped. */
  async function setupStaffColumns(mq) {
    // 1. Read the current column list.
    const data = await mq(`{ boards(ids:[${STAFF_BOARD}]) { columns { id title type } } }`);
    const cols = data?.boards?.[0]?.columns || [];
    const existingTitles = new Set(cols.map(c => (c.title || '').trim().toLowerCase()));

    // 2. Create the gaps.
    const created = [];
    for (const def of NEW_COLUMN_DEFS) {
      if (existingTitles.has(def.title.toLowerCase())) continue;
      const defStr = def.defaults
        ? `, defaults: ${JSON.stringify(JSON.stringify(def.defaults))}`
        : '';
      try {
        await mq(`mutation {
          create_column(board_id: ${STAFF_BOARD}, title: "${def.title.replace(/"/g,'\\"')}", column_type: ${def.column_type}${defStr}) { id }
        }`);
        created.push(def.title);
      } catch (e) {
        if (defStr) {
          // Retry without defaults if Monday rejected them.
          await mq(`mutation {
            create_column(board_id: ${STAFF_BOARD}, title: "${def.title.replace(/"/g,'\\"')}", column_type: ${def.column_type}) { id }
          }`);
          created.push(def.title);
        } else {
          throw new Error(`Failed creating "${def.title}": ${e.message}`);
        }
      }
    }

    // 3. Re-read to capture the assigned IDs and refresh the cache.
    const refresh = await mq(`{ boards(ids:[${STAFF_BOARD}]) { id columns { id title type } } }`);
    const newColumns = resolveNewColumns(refresh?.boards?.[0]?.columns || []);
    const result = { boardId: STAFF_BOARD, existing: EXISTING, newColumns, missing: [], created };
    writeCache(result);
    return result;
  }

  /* For each staff member whose new "Roles" multi-select is empty, write
     their primary Role into it as a starting set. One-shot — running
     again is a no-op for anyone whose Roles are already populated.
     Returns { seeded: N, skipped: M }. */
  async function seedRolesFromPrimary(mq, config) {
    const rolesCol = config.newColumns.rolesAll;
    if (!rolesCol) throw new Error('Roles column not provisioned yet — run setup first.');
    // Read every staff row's primary role + roles dropdown.
    const data = await mq(`{
      boards(ids:[${STAFF_BOARD}]) {
        items_page(limit: 200) {
          items {
            id name
            column_values(ids:["${EXISTING.ST_ROLE}","${rolesCol}"]) { id text value }
          }
        }
      }
    }`);
    const items = data?.boards?.[0]?.items_page?.items || [];
    let seeded = 0, skipped = 0;
    for (const it of items) {
      const cv = Object.fromEntries((it.column_values || []).map(c => [c.id, c]));
      const primary = (cv[EXISTING.ST_ROLE]?.text || '').trim();
      const rolesText = (cv[rolesCol]?.text || '').trim();
      if (!primary) { skipped++; continue; }   // no primary set
      if (rolesText) { skipped++; continue; }  // already has roles
      const cvWrite = JSON.stringify({ [rolesCol]: { labels: [primary] } });
      try {
        await mq(`mutation($i:ID!,$v:JSON!){ change_multiple_column_values(board_id:${STAFF_BOARD}, item_id:$i, column_values:$v, create_labels_if_missing:true){ id } }`,
          { i: it.id, v: cvWrite });
        seeded++;
      } catch (_) { skipped++; }
    }
    return { seeded, skipped };
  }

  function clearCache() {
    try { localStorage.removeItem(CACHE_KEY); } catch (_) {}
  }

  /* ── Helpers shared between manager + self-service views ─────────────── */

  /* Compute the current leave year window for a given staff member.
     leaveYearStartISO is the date column value, e.g. '2026-01-01'. If
     blank, defaults to 1 January of the current calendar year. Returns
     { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' } where end = start + 1 year
     - 1 day. Wraps correctly when "today" sits before the start date —
     the active leave year is then the previous one. */
  function currentLeaveYearWindow(leaveYearStartISO) {
    const today = new Date(); today.setHours(0,0,0,0);
    let anchor;
    if (leaveYearStartISO) {
      anchor = new Date(leaveYearStartISO + 'T12:00:00');
    } else {
      anchor = new Date(today.getFullYear(), 0, 1);
    }
    // Move anchor to the most recent occurrence on/before today.
    let start = new Date(today.getFullYear(), anchor.getMonth(), anchor.getDate());
    if (start > today) start.setFullYear(start.getFullYear() - 1);
    const end = new Date(start); end.setFullYear(end.getFullYear() + 1); end.setDate(end.getDate() - 1);
    const fmt = (d) => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    return { start: fmt(start), end: fmt(end) };
  }

  /* Sum the hours used by a staff member in the active leave year, given
     the approved Annual leave rows from the Leave Requests board.

     Smart per-staff calculation:
       1. workingDays — set of weekdays (1=Mon..7=Sun) the staff actually
          works. Comes from the staff member's `prefDays` multi-select.
          Falls back to Mon–Fri (1..5) when the staff hasn't set their
          preferences yet.
       2. hoursPerDay — taken from the staff member's `stdHoursDay` field
          when set. Otherwise derived from contractHrs ÷ workingDays.length
          (e.g. 35h/wk over Mon-Fri = 7h/day). Final fallback is 8h.

     For each approved Annual leave request, we walk every day in the
     range, count only the ones whose weekday is in workingDays, and
     multiply that count by hoursPerDay. Sick days and Personal/unpaid
     don't deduct from the entitlement.

     staffCfg: { prefDays:[], stdHoursDay, contractHrs }
     leaveRows: array of { type, status, startDate, endDate } from leave-inbox parsing.
     window: { start, end } from currentLeaveYearWindow(). */
  function computeLeaveUsage(leaveRows, staffCfg, window) {
    // Map prefDays labels (Mon..Sun) → JS weekday number (1..7, where Sun=7).
    const dayLabelToNum = { Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6, Sun:7 };
    let workingDays;
    if (staffCfg && Array.isArray(staffCfg.prefDays) && staffCfg.prefDays.length) {
      workingDays = new Set(staffCfg.prefDays.map(d => dayLabelToNum[d]).filter(Boolean));
    } else {
      workingDays = new Set([1,2,3,4,5]);   // default Mon–Fri
    }
    let hpd;
    if (staffCfg && parseFloat(staffCfg.stdHoursDay) > 0) {
      hpd = parseFloat(staffCfg.stdHoursDay);
    } else if (staffCfg && parseFloat(staffCfg.contractHrs) > 0 && workingDays.size > 0) {
      hpd = parseFloat(staffCfg.contractHrs) / workingDays.size;
    } else {
      hpd = 8;
    }

    let used = 0;
    for (const r of (leaveRows || [])) {
      if (r.status !== 'Approved') continue;
      if (r.type !== 'Annual leave') continue;          // only annual deducts
      if (!r.startDate) continue;
      const start = r.startDate;
      const end = r.endDate || r.startDate;
      if (end < window.start || start > window.end) continue;
      const effStart = start < window.start ? window.start : start;
      const effEnd   = end   > window.end   ? window.end   : end;
      // Iterate inclusively, counting only working weekdays.
      const cur = new Date(effStart + 'T12:00:00');
      const stop = new Date(effEnd   + 'T12:00:00');
      while (cur <= stop) {
        const dow = cur.getDay();              // 0=Sun..6=Sat
        const dowMonFirst = dow === 0 ? 7 : dow; // 1=Mon..7=Sun
        if (workingDays.has(dowMonFirst)) used += hpd;
        cur.setDate(cur.getDate() + 1);
      }
    }
    return used;
  }

  // Expose on window so plain inline <script> blocks can use these.
  window.StaffSchema = {
    STAFF_BOARD,
    EXISTING,
    NEW_COLUMN_DEFS,
    PRIMARY_ROLE_LABELS,
    getStaffConfig,
    setupStaffColumns,
    seedRolesFromPrimary,
    clearCache,
    currentLeaveYearWindow,
    computeLeaveUsage,
  };
})();
