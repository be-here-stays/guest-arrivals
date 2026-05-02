// ─────────────────────────────────────────────────────────────────────────────
// Linen schema — single source of truth for board IDs, column IDs and the
// canonical item list. Every linen-related HTML page should include this via
// <script src="linen-schema.js"></script> so renames/restructures only happen
// in one place.
//
// Created: 2026-05-01 (Cowork session, design approved by Barry).
// Workspace: Housekeeping (id 6216906) on Cotswold Water Park Retreats Monday.
// ─────────────────────────────────────────────────────────────────────────────

const LINEN = {
  // ── Boards ────────────────────────────────────────────────────────────────
  boards: {
    stock:     '5095654616',  // Linen Stock     — live shelf state, 30 rows (item × type)
    bags:      '5095654933',  // Linen Bags      — operational bags with lifecycle + transport
    movements: '5095655085',  // Linen Movements — append-only audit log
    arrivals:  '5094453064',  // Guest Arrivals  — existing board, used for bag.arrival link
    propertyConfig: '5094466278', // Property Config — existing, used by laundry-rota for bedConfig
    staff:     '5095127554',  // Staff           — existing, used for driver assignment
  },

  // ── Property Config columns (just the ones used by linen flow) ───────────
  propertyColumns: {
    fixedBeds:  'text_mm2a2a78',
    bedOptions: 'long_text_mm2a30dy',
    supplier:   'dropdown_mm2k2p4p',
    bathrooms:  'numeric_mm2drc46',
    hasHotTub:  'boolean_mm2rpzzh',
    bagColour:  'color_mm2zj3ya',  // OPTIONAL default colour for this property — used to pre-fill the bag modal. The actual colour is stored per-bag on Linen Bags.
  },

  // ── Staff board columns ───────────────────────────────────────────────────
  staffColumns: {
    role:       'color_mm2psadz', // status: A Team / Housekeeper / Maintenance / Checker / Van driver / Owner / Manager
    status:     'color_mm2psvh2', // status: Annual leave / Active / Sick / Training / Off
    code:       'text_mm2qd59j',  // 4-digit staff code (used by staff.html auth)
    phone:      'phone_mm2pyswz',
    email:      'email_mm2pa071',
    notes:      'long_text_mm2pzgnc',
    rate:       'numeric_mm2p4pme',
    contractHrs:'numeric_mm2pc978',
  },

  // ── Linen Stock columns (board 5095654616) ────────────────────────────────
  stockColumns: {
    type:           'color_mm2y9vqv',        // status: Own / Regency
    currentCount:   'numeric_mm2yrhxn',
    minLevel:       'numeric_mm2ydmv3',
    lastCounted:    'date_mm2ygjh8',
    lastCountedBy:  'multiple_person_mm2yyy6t',
  },

  // ── Linen Bags columns (board 5095654933) ─────────────────────────────────
  bagsColumns: {
    arrival:         'board_relation_mm2y42yx',  // → Guest Arrivals
    linenType:       'color_mm2y10tf',           // status: Own / Regency
    status:          'color_mm2y42bf',           // status: Planned / Bagged / In transit / Delivered
    transportMethod: 'color_mm2ynfjy',           // status: Laundry van / Staff (own car) / Manager (own car) / Maintenance van / Other
    driver:          'multiple_person_mm2yq081',
    baggedAt:        'date_mm2yag8v',
    pickedUpAt:      'date_mm2yrj5',
    deliveredAt:     'date_mm2y9q22',
    notes:           'long_text_mm2yq1mc',

    // Driver assignment + dirties pickup (added 2026-05-01)
    driverStaff:        'board_relation_mm2ybqxy',  // → Staff board (cleans delivery)
    dirtiesDriverStaff: 'board_relation_mm2yc98d',  // → Staff board (dirties pickup — may differ from cleans driver)
    dirtiesCollectedAt: 'date_mm2ypphk',
    dirtiesCollectedBy: 'board_relation_mm2yavqf',  // → Staff board (who actually did the pickup)

    // Bag count (added 2026-05-01) — how many physical bags the delivery
    // is split across.
    numberOfBags:       'numeric_mm2z324m',
    // Bag colour (per-delivery). Pre-fills from the property's default (on
    // Property Config) but can be overridden each changeover.
    bagColour:          'color_mm2z7dy',

    // Item count columns — one per linen item (all numbers)
    items: {
      skDuvets:     'numeric_mm2ynm7s',
      kingDuvets:   'numeric_mm2y3js3',
      doubleDuvets: 'numeric_mm2y4zsn',
      singleDuvets: 'numeric_mm2y8tyt',
      kingSheets:   'numeric_mm2yx0hz',
      doubleSheets: 'numeric_mm2yz323',
      singleSheets: 'numeric_mm2y92sm',
      oxford:       'numeric_mm2yx0jd',
      standard:     'numeric_mm2yfx9s',
      bathTowels:   'numeric_mm2yfp7r',
      handTowels:   'numeric_mm2ydf4m',
      hotTubTowels: 'numeric_mm2ykc23',
      bathrobes:    'numeric_mm2ym9sc',
      teaTowels:    'numeric_mm2yhc5h',
      bathMats:     'numeric_mm2yvtgr',
    },
  },

  // ── Linen Movements columns (board 5095655085) ────────────────────────────
  movementsColumns: {
    type:          'color_mm2y6qhj',         // status: Stock take / Regency in / Wash run in / Property return / Bag out / Manual adjustment
    linenType:     'color_mm2yvce5',         // status: Own / Regency
    item:          'board_relation_mm2yw9jz', // → Linen Stock
    qty:           'numeric_mm2ye33b',        // signed
    linkedBag:     'board_relation_mm2yc9ej', // → Linen Bags
    linkedArrival: 'board_relation_mm2yp7m9', // → Guest Arrivals
    notes:         'long_text_mm2yjx49',
    recordedBy:    'multiple_person_mm2ybnk9',
    recordedAt:    'date_mm2yz39g',
  },

  // ── Status label values (must match Monday exactly) ───────────────────────
  labels: {
    type:            { own: 'Own', regency: 'Regency' },
    bagStatus:       { planned: 'Planned', bagged: 'Bagged', inTransit: 'In transit', delivered: 'Delivered' },
    transportMethod: {
      van:         'Laundry van',
      staff:       'Staff (own car)',
      manager:     'Manager (own car)',
      maintenance: 'Maintenance van',
      other:       'Other',
    },
    movementType: {
      stockTake:        'Stock take',
      regencyIn:        'Regency in',
      washRunIn:        'Wash run in',
      propertyReturn:   'Property return',
      bagOut:           'Bag out',
      manualAdjustment: 'Manual adjustment',
    },
  },

  // ── Role → default transport method mapping ───────────────────────────────
  // When a driver is assigned to a bag, the transport method auto-fills from
  // the driver's role (overrideable). Match values exactly to the Staff board's
  // Role column labels and the Linen Bags board's Transport method labels.
  roleToTransport: {
    'Van driver':       'Laundry van',
    'Maintenance':      'Maintenance van',
    'Manager':          'Manager (own car)',
    'Owner':            'Manager (own car)',
    'A Team':           'Staff (own car)',
    'Housekeeper':      'Staff (own car)',
    'Checker':          'Staff (own car)',
  },

  // ── Canonical item list ───────────────────────────────────────────────────
  // `id` is the key used in bagsColumns.items and as a stable internal handle.
  // `label` matches the Linen Stock item Name (used to query stock rows).
  // `section` is purely for grouping in the UI.
  // `defaultMin` is the seeded minimum level on the stock rows.
  items: [
    { id: 'skDuvets',     label: 'Super King Duvets',    section: 'Duvets',            defaultMin: 4  },
    { id: 'kingDuvets',   label: 'King Duvets',          section: 'Duvets',            defaultMin: 4  },
    { id: 'doubleDuvets', label: 'Double Duvets',        section: 'Duvets',            defaultMin: 6  },
    { id: 'singleDuvets', label: 'Single Duvets',        section: 'Duvets',            defaultMin: 8  },
    { id: 'kingSheets',   label: 'Superking Sheets',     section: 'Sheets',            defaultMin: 8  },
    { id: 'doubleSheets', label: 'Double Sheets',        section: 'Sheets',            defaultMin: 10 },
    { id: 'singleSheets', label: 'Single Sheets',        section: 'Sheets',            defaultMin: 12 },
    { id: 'oxford',       label: 'Oxford Pillow Cases',  section: 'Pillows & Towels',  defaultMin: 20 },
    { id: 'standard',     label: 'Standard Pillow Cases',section: 'Pillows & Towels',  defaultMin: 20 },
    { id: 'bathTowels',   label: 'Bath Towels',          section: 'Pillows & Towels',  defaultMin: 20 },
    { id: 'handTowels',   label: 'Hand Towels',          section: 'Pillows & Towels',  defaultMin: 20 },
    { id: 'hotTubTowels', label: 'Hot Tub Towels',       section: 'Pillows & Towels',  defaultMin: 10 },
    { id: 'bathrobes',    label: 'Bathrobes',            section: 'Pillows & Towels',  defaultMin: 10 },
    { id: 'teaTowels',    label: 'Tea Towels',           section: 'Pillows & Towels',  defaultMin: 12 },
    { id: 'bathMats',     label: 'Bath Mats',            section: 'Pillows & Towels',  defaultMin: 12 },
  ],

  // ── Stock row IDs (item × type) ───────────────────────────────────────────
  // Use these for direct mutations to a specific stock row instead of querying
  // by name + type each time. Keyed as `${itemId}_${type}` (type = 'own' | 'regency').
  stockRowIds: {
    skDuvets_own:     '2884815559', skDuvets_regency:     '2884805301',
    kingDuvets_own:   '2884814034', kingDuvets_regency:   '2884805302',
    doubleDuvets_own: '2884814262', doubleDuvets_regency: '2884811841',
    singleDuvets_own: '2884809338', singleDuvets_regency: '2884805303',
    kingSheets_own:   '2884811758', kingSheets_regency:   '2884811852',
    doubleSheets_own: '2884811858', doubleSheets_regency: '2884808909',
    singleSheets_own: '2884815560', singleSheets_regency: '2884815566',
    oxford_own:       '2884815561', oxford_regency:       '2884814353',
    standard_own:     '2884813823', standard_regency:     '2884811745',
    bathTowels_own:   '2884809118', bathTowels_regency:   '2884809064',
    handTowels_own:   '2884811851', handTowels_regency:   '2884815599',
    hotTubTowels_own: '2884814392', hotTubTowels_regency: '2884813921',
    bathrobes_own:    '2884808846', bathrobes_regency:    '2884809134',
    teaTowels_own:    '2884812180', teaTowels_regency:    '2884815679',
    bathMats_own:     '2884811875', bathMats_regency:     '2884813922',
  },
};

// Helper — get the stock row id for a given item × type combination.
function stockRowId(itemId, type /* 'own' | 'regency' */) {
  return LINEN.stockRowIds[`${itemId}_${type}`] || null;
}

// Helper — given a Role label from the Staff board, return the default
// Transport method label for the Linen Bags board. Falls back to "Staff (own car)".
function transportForRole(roleLabel) {
  const r = (roleLabel || '').trim();
  return LINEN.roleToTransport[r] || 'Staff (own car)';
}

// ── Bag colour palette ────────────────────────────────────────────────────
// Maps the Property Config "Bag colour" status labels to CSS colours used by
// the swatch chips throughout the UI. Each entry has:
//   swatch — the colour of the small square shown next to the label
//   bg     — background tint when the chip is filled
//   text   — text colour over that background
const BAG_COLOUR_PALETTE = {
  'Black':  { swatch: '#1a1a1a', bg: '#1a1a1a', text: '#fff' },
  'Blue':   { swatch: '#1a6fba', bg: '#dceaff', text: '#0d3d6e' },
  'Green':  { swatch: '#2d6a4f', bg: '#d4edda', text: '#1e4a37' },
  'Yellow': { swatch: '#f5c518', bg: '#fff5cc', text: '#7a5800' },
  'Red':    { swatch: '#c0392b', bg: '#fde8e8', text: '#7a1f15' },
  'Pink':   { swatch: '#e484bd', bg: '#fbe7f3', text: '#8a3a6a' },
  'Orange': { swatch: '#fdab3d', bg: '#fff2d8', text: '#9c5e10' },
  'Purple': { swatch: '#9d50dd', bg: '#ede1fa', text: '#5d2891' },
  'White':  { swatch: '#ffffff', bg: '#fafafa', text: '#333' },
  'Clear':  { swatch: 'transparent', bg: '#f0f0ee', text: '#666' },
  'Other':  { swatch: '#999999', bg: '#eeeeee', text: '#555' },
};
function bagColourSwatch(name) {
  return BAG_COLOUR_PALETTE[(name || '').trim()] || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// BAGGING TEMPLATE — rules confirmed by Barry on 2026-05-01.
// Per-bed bedding plus per-guest, per-bathroom and per-property extras.
// Used by the Linen Rota bag modal to derive quantities from a stay's
// bed config + guest counts + property config (bathrooms, hot tub).
// ─────────────────────────────────────────────────────────────────────────────
const BAG_TEMPLATE = {
  perBed: {
    superKing: { skDuvets: 1,     kingSheets: 1,   oxford: 4 },   // SK uses Superking Sheet
    king:      { kingDuvets: 1,   kingSheets: 1,   oxford: 4 },   // King also uses Superking Sheet
    double:    { doubleDuvets: 1, doubleSheets: 1, standard: 2 },
    single:    { singleDuvets: 1, singleSheets: 1, standard: 1 },
  },
  perAdult:    { bathTowels: 1, handTowels: 1, bathrobes: 1 },
  perChild:    { bathTowels: 1, handTowels: 1 },
  perFullBath: { bathMats: 1,   handTowels: 1 },          // bath mats only on full baths
  perHalfBath: {                handTowels: 1 },          // hand towels include halves
  perProperty: { teaTowels: 2 },                          // flat per stay
  perGuestHotTub: { hotTubTowels: 1 },                    // only when hasHotTub
};

// Compute the canonical bag for a stay.
//   beds       = { superKing, king, double, single } (counts)
//   adults     = number
//   children   = number
//   bathrooms  = number (e.g. 1.5 means 1 full + 1 half)
//   hasHotTub  = boolean
// Returns an object keyed by LINEN.items[*].id with quantity values.
function computeBagTemplate({ beds, adults = 0, children = 0, bathrooms = 1, hasHotTub = false } = {}) {
  const out = {};
  const add = (itemId, qty) => {
    if (!qty) return;
    out[itemId] = (out[itemId] || 0) + qty;
  };

  // Per bed type
  for (const [bedType, count] of Object.entries(beds || {})) {
    if (!count || !BAG_TEMPLATE.perBed[bedType]) continue;
    for (const [itemId, perBed] of Object.entries(BAG_TEMPLATE.perBed[bedType])) {
      add(itemId, count * perBed);
    }
  }

  // Per guest
  for (let i = 0; i < adults; i++) {
    for (const [itemId, qty] of Object.entries(BAG_TEMPLATE.perAdult)) add(itemId, qty);
  }
  for (let i = 0; i < children; i++) {
    for (const [itemId, qty] of Object.entries(BAG_TEMPLATE.perChild)) add(itemId, qty);
  }

  // Bathrooms — full vs half from the .5 convention
  const fullBaths = Math.floor(bathrooms || 0);
  const halfBaths = (bathrooms || 0) - fullBaths > 0 ? 1 : 0;
  for (let i = 0; i < fullBaths; i++) {
    for (const [itemId, qty] of Object.entries(BAG_TEMPLATE.perFullBath)) add(itemId, qty);
  }
  for (let i = 0; i < halfBaths; i++) {
    for (const [itemId, qty] of Object.entries(BAG_TEMPLATE.perHalfBath)) add(itemId, qty);
  }

  // Flat per property
  for (const [itemId, qty] of Object.entries(BAG_TEMPLATE.perProperty)) add(itemId, qty);

  // Hot tub towels (per guest, only on hot tub properties)
  if (hasHotTub) {
    const totalGuests = adults + children;
    for (let i = 0; i < totalGuests; i++) {
      for (const [itemId, qty] of Object.entries(BAG_TEMPLATE.perGuestHotTub)) add(itemId, qty);
    }
  }

  return out;
}

// Build a human-readable breakdown of how the template was computed.
// Returns an array of strings ("1 SK bed → 1 SK duvet · 1 sheet · 4 Oxford", etc.)
function describeBagTemplate({ beds, adults = 0, children = 0, bathrooms = 1, hasHotTub = false } = {}) {
  const lines = [];
  const labels = { superKing: 'Super King', king: 'King', double: 'Double', single: 'Single' };
  for (const [bedType, count] of Object.entries(beds || {})) {
    if (!count) continue;
    const items = BAG_TEMPLATE.perBed[bedType] || {};
    const itemStr = Object.entries(items)
      .map(([id, q]) => `${q * count} ${(LINEN.items.find(i => i.id === id)?.label) || id}`)
      .join(' · ');
    lines.push(`${count}× ${labels[bedType]} bed → ${itemStr}`);
  }
  if (adults)   lines.push(`${adults} adult${adults > 1 ? 's' : ''} → ${adults} bath towel${adults > 1 ? 's' : ''}, ${adults} hand towel${adults > 1 ? 's' : ''}, ${adults} bathrobe${adults > 1 ? 's' : ''}`);
  if (children) lines.push(`${children} child${children > 1 ? 'ren' : ''} → ${children} bath towel${children > 1 ? 's' : ''}, ${children} hand towel${children > 1 ? 's' : ''}`);
  const fullBaths = Math.floor(bathrooms || 0);
  const halfBaths = (bathrooms || 0) - fullBaths > 0 ? 1 : 0;
  if (fullBaths) lines.push(`${fullBaths} full bath${fullBaths > 1 ? 's' : ''} → ${fullBaths} bath mat${fullBaths > 1 ? 's' : ''}, ${fullBaths} hand towel${fullBaths > 1 ? 's' : ''}`);
  if (halfBaths) lines.push(`${halfBaths} half bath → ${halfBaths} hand towel`);
  lines.push(`Per property → 2 tea towels`);
  if (hasHotTub) {
    const g = adults + children;
    if (g) lines.push(`Hot tub property × ${g} guest${g > 1 ? 's' : ''} → ${g} hot tub towel${g > 1 ? 's' : ''}`);
  }
  return lines;
}

// Expose to global scope for non-module use.
if (typeof window !== 'undefined') {
  window.LINEN = LINEN;
  window.stockRowId = stockRowId;
  window.transportForRole = transportForRole;
  window.BAG_TEMPLATE = BAG_TEMPLATE;
  window.computeBagTemplate = computeBagTemplate;
  window.describeBagTemplate = describeBagTemplate;
  window.BAG_COLOUR_PALETTE = BAG_COLOUR_PALETTE;
  window.bagColourSwatch = bagColourSwatch;
}
