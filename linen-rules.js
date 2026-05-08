// ─────────────────────────────────────────────────────────────────────────────
// linen-rules.js — shared bed-config parsing and linen requirements.
//
// Single source of truth for "given a booking shape, what linen do we need?"
// Pulled out of status-board.html (where this logic was originally written) so
// every page that needs to know — packing tools, the housekeeper's linen-issue
// form, the daily totals view — calls one function instead of duplicating the
// rules.
//
// Usage:
//   <script src="linen-schema.js"></script>     <!-- for LINEN.bagsColumns -->
//   <script src="linen-rules.js"></script>
//   const beds = LinenRules.parseBedString("1 SK + 4 S");
//   const req  = LinenRules.requiredLinen(beds, 4, 2, propertyCfg);
//
// All functions are pure — no DOM, no fetch. Safe to use in any context.
// ─────────────────────────────────────────────────────────────────────────────

(function (global) {
  'use strict';

  /* ── Bed-string parsing ───────────────────────────────────────────────────
     Turns free text like "1 SK + 4 S", "2 doubles + 1 twin", "Super King +
     2 Singles" into a structured count of beds by size. Tolerant of slang,
     hyphens, parenthesised "optional" text, and incidental items like sofa
     beds, cots, bunks (which carry no linen requirement of their own).

     "N twins" → N single beds; bare "twin" → 2 single beds (a twin room).
     "Super-King", "super king", "SK" → SK count.
  */
  function parseBedString(str) {
    if (!str) return { superKing: 0, king: 0, double: 0, single: 0 };
    let s = String(str)
      .replace(/super[\s-]?king/gi, 'SUPERKING')
      .replace(/\(?[+&]?\s*optional\b[^)]*\)?/gi, '')
      .replace(/\bsofa\s*bed\b/gi, '').replace(/\bsofa\b/gi, '')
      .replace(/\bcot\b/gi, '').replace(/\bbunk\b/gi, '');

    function numOf(pattern, text) {
      let total = 0, m;
      const re = new RegExp('(\\d+)\\s*' + pattern + 's?\\b', 'gi');
      while ((m = re.exec(text)) !== null) total += parseInt(m[1], 10);
      if (total === 0 && new RegExp('\\b' + pattern + 's?\\b', 'i').test(text)) total = 1;
      return total;
    }

    const superKing = numOf('SUPERKING', s);
    const noSK   = s.replace(/\d*\s*SUPERKINGS?\b/gi, '');
    const king   = numOf('king', noSK);
    const double_ = numOf('double', s);

    let twinBeds = 0, m;
    const tRe = /(\d+)\s*twins?\b/gi;
    while ((m = tRe.exec(s)) !== null) twinBeds += parseInt(m[1], 10);
    if (twinBeds === 0 && /\btwins?\b/i.test(s)) twinBeds = 2;

    return {
      superKing,
      king,
      double:  double_,
      single:  numOf('single', s) + twinBeds,
    };
  }

  /* ── Effective beds for a booking ─────────────────────────────────────────
     Three statuses:
       'confirmed' — booking has explicit bedConfig text → use it verbatim
       'fixed'     — property has no configurable options → fixed beds only
       'assumed'   — fall back to fixed + the option with the fewest singles

     propertyCfg expected shape:
       { fixedBeds: string, bedOptions: [string] }
     Any field may be absent — we default everything to zero/empty.
  */
  function getEffectiveBeds(bedConfigText, propertyCfg) {
    const cfg = propertyCfg || {};
    const fixed = parseBedString(cfg.fixedBeds || '');
    const hasOptions = Array.isArray(cfg.bedOptions) && cfg.bedOptions.length > 0;

    if (bedConfigText && String(bedConfigText).trim()) {
      return { beds: parseBedString(bedConfigText), status: 'confirmed' };
    }
    if (!hasOptions) return { beds: fixed, status: 'fixed' };

    // No confirmed config — pick the option with fewest singles (adults-first
    // assumption). Add to fixed.
    let configurable = { superKing: 0, king: 0, double: 0, single: 0 };
    let fewestSingles = Infinity;
    for (const opt of cfg.bedOptions) {
      const c = parseBedString(opt);
      if (c.single < fewestSingles) { fewestSingles = c.single; configurable = c; }
    }
    return {
      beds: {
        superKing: fixed.superKing + configurable.superKing,
        king:      fixed.king      + configurable.king,
        double:    fixed.double    + configurable.double,
        single:    fixed.single    + configurable.single,
      },
      status: 'assumed',
    };
  }

  /* ── Linen requirements for a single booking ──────────────────────────────
     Given parsed beds + guest counts + property config, return the per-item
     linen counts using the same rules as status-board.html:

       Duvets  : 1 per bed of that size
       Sheets  : SK and King share the king sheet (so kingSheets = SK + K beds)
       Pillows : (SK+K+D)×2 + S×1 — both oxford and standard get this number
       Bath    : 1 per guest
       Hand    : guests + bathrooms
       Tea     : 2 (always)
       Mats    : 1 per bathroom
       Hot tub : guests, only if property has a hot tub
       Robes   : adults, only if property has a hot tub

     Property config can override `bathrooms` (default 1) and `hasHotTub`
     (default false). Returns the same shape as LINEN.bagsColumns.items in
     linen-schema.js, so the result drops straight into a Linen Bags row.
  */
  function requiredLinen(beds, adults, children, propertyCfg) {
    const cfg = propertyCfg || {};
    const bathrooms = Math.max(1, Number(cfg.bathrooms) || 1);
    const hasHotTub = !!cfg.hasHotTub;

    const a = Math.max(0, Number(adults)   || 0);
    const ch = Math.max(0, Number(children) || 0);
    // If we don't have a guest count, fall back to bed spaces (so packers
    // get something sensible rather than zero towels). SK/K/D = 2, single = 1.
    const totalBedSpaces = (beds.superKing + beds.king + beds.double) * 2 + beds.single;
    const confirmedGuests = a + ch;
    const guests = confirmedGuests > 0
      ? confirmedGuests
      : (Number(cfg.maxOccupancy) || totalBedSpaces || 2);
    const adultsForRobe = a > 0 ? a : guests;

    // Pillows: 2 per double-occupancy bed, 1 per single.
    const doublePillows = (beds.superKing + beds.king + beds.double) * 2;
    const singlePillows = beds.single;
    const pillowsEach   = doublePillows + singlePillows;

    return {
      // Duvets — one per bed
      skDuvets:     beds.superKing,
      kingDuvets:   beds.king,
      doubleDuvets: beds.double,
      singleDuvets: beds.single,

      // Sheets — SK and King share king-sized sheet
      kingSheets:   beds.superKing + beds.king,
      doubleSheets: beds.double,
      singleSheets: beds.single,

      // Pillows — same count of oxford and standard
      oxford:   pillowsEach,
      standard: pillowsEach,

      // Towels & misc
      bathTowels:   guests,
      handTowels:   guests + bathrooms,
      teaTowels:    2,
      bathMats:     bathrooms,
      hotTubTowels: hasHotTub ? guests          : 0,
      bathrobes:    hasHotTub ? adultsForRobe   : 0,
    };
  }

  /* ── Convenience: end-to-end from a booking shape ─────────────────────────
     Pass a booking-like object; returns {beds, status, required, summary}.
     Booking shape needs at least:  { bedConfig?, adults?, children?, property }
     and a propertyCfg lookup is provided alongside.
  */
  function requirementsFor(booking, propertyCfg) {
    const eff = getEffectiveBeds(booking.bedConfig || '', propertyCfg);
    const required = requiredLinen(
      eff.beds,
      booking.adults || 0,
      booking.children || 0,
      propertyCfg,
    );
    return {
      beds: eff.beds,
      status: eff.status,            // 'confirmed' | 'fixed' | 'assumed'
      required,
      summary: bedSummary(eff.beds), // human-readable bed line
    };
  }

  /* Human-readable bed summary, e.g. "1 s/king · 4 single". */
  function bedSummary(beds) {
    const parts = [];
    if (beds.superKing) parts.push(`${beds.superKing} s/king`);
    if (beds.king)      parts.push(`${beds.king} king`);
    if (beds.double)    parts.push(`${beds.double} dbl`);
    if (beds.single)    parts.push(`${beds.single} single`);
    return parts.join(' · ');
  }

  /* ── Display labels for each item key ─────────────────────────────────────
     Used by pack-bag.html and report-linen.html. Order here is the order
     packing rows appear in the UI — duvets first, then sheets, pillows,
     towels, then property-specific items.
  */
  const ITEM_LABELS = {
    skDuvets:     'SK duvets',
    kingDuvets:   'King duvets',
    doubleDuvets: 'Double duvets',
    singleDuvets: 'Single duvets',
    kingSheets:   'King sheets (SK+K)',
    doubleSheets: 'Double sheets',
    singleSheets: 'Single sheets',
    oxford:       'Oxford pillowcases',
    standard:     'Standard pillowcases',
    bathTowels:   'Bath towels',
    handTowels:   'Hand towels',
    teaTowels:    'Tea towels',
    bathMats:     'Bath mats',
    hotTubTowels: 'Hot tub towels',
    bathrobes:    'Bathrobes',
  };
  const ITEM_ORDER = Object.keys(ITEM_LABELS);

  /* Filter to only items with non-zero requirement (for compact packing UI). */
  function nonZeroItems(req) {
    return ITEM_ORDER.filter(k => (req[k] || 0) > 0);
  }

  /* Diff packed-vs-required: returns array of { key, label, required, packed,
     diff } where diff = packed - required (negative = short, 0 = ok,
     positive = over-packed). Items with required=0 AND packed=0 are skipped. */
  function diffPackedVsRequired(required, packed) {
    const out = [];
    const seen = new Set();
    for (const k of ITEM_ORDER) {
      const req = required[k] || 0;
      const pk  = packed[k]   || 0;
      if (req === 0 && pk === 0) continue;
      out.push({ key: k, label: ITEM_LABELS[k], required: req, packed: pk, diff: pk - req });
      seen.add(k);
    }
    // Surface packed items that aren't in our canonical list (defensive).
    for (const k of Object.keys(packed)) {
      if (seen.has(k)) continue;
      const pk = packed[k] || 0;
      if (pk > 0) out.push({ key: k, label: k, required: 0, packed: pk, diff: pk });
    }
    return out;
  }

  /* ── Export ───────────────────────────────────────────────────────────── */
  global.LinenRules = {
    parseBedString,
    getEffectiveBeds,
    requiredLinen,
    requirementsFor,
    bedSummary,
    diffPackedVsRequired,
    nonZeroItems,
    ITEM_LABELS,
    ITEM_ORDER,
  };

})(typeof window !== 'undefined' ? window : globalThis);
