# Orphan-night linker — design note

## Problem

Sometimes we sell a single spare night to extend a guest's stay, either
at the end of their booking or the beginning of the next one. The guest
is the same person (same phone), but Guesty issues **two booking
references**, which land as **two Cleans rows** — even though only one
clean is actually needed (the guest is already in situ between the two
legs).

## Linking rule

- Match key: **normalised phone number** (strip `+`, spaces, hyphens)
- Additional constraint: **same property** AND **touching dates** — i.e.
  `bookingA.checkOut == bookingB.checkIn`.
- The orphan night may be **either side** — before or after — depending
  on who bought the extra night.
- **The LATER clean is always the absorbed one**, because Cleans are
  keyed on check-in (arrival), and the later arrival is the "ghost"
  arrival where the guest is already present.

## Writes

On BOTH Cleans rows (board `5095134636`), set:

| Column          | Column ID              | Value                                                        |
| --------------- | ---------------------- | ------------------------------------------------------------ |
| Linked ref      | `text_mm2qh78j`        | The PARTNER row's Monday item id (numeric string)            |
| Linked note     | `long_text_mm2qp4ay`   | Human-readable: `Contiguous stay with <partner ref> — guest bought the orphan night` |

On both Guest Arrivals rows (board `5094453064`), also set (optional,
for audit / future reporting):

| Column          | Column ID              | Value                           |
| --------------- | ---------------------- | ------------------------------- |
| Linked ref      | `text_mm2qb005`        | PARTNER GA row's Monday item id |
| Linked note     | `long_text_mm2q8e1`    | Same note                       |

## Rota-planner behaviour (already built)

`rota-planner.html` treats any Clean whose `linkedRef` points to a
Cleans row with an EARLIER check-in date as **absorbed**:

- Rendered with `.absorbed` CSS class (55 % opacity, struck-through property name, diagonal stripes, "Linked" badge)
- Hours are excluded from `hkAllocatedForDay()` so the HK capacity bar reflects reality
- The linked note is shown on both cards so the planner knows why

## Staff-page behaviour (already built)

`staff.html` applies the same rule: if `cleanIsAbsorbed(c)` returns
true, the "Mark complete" button is hidden and the card is struck
through. The non-absorbed sibling remains fully actionable.

## Proposed Make scenario — "Guesty → Orphan-night linker"

Separate from the existing Guesty → Booking watcher (9117620) so that
a bug here can't take the main watcher down. Runs every 60 minutes.

### Flow

1. **HTTP: Get Guesty OAuth token** — identical to watcher scenario module 1.

2. **HTTP: Get all future reservations**
   - `GET /v1/reservations`
   - Query: `filters[0][field]=checkIn`, `operator=$gte`, `value={{formatDate(now; "YYYY-MM-DD")}}`, `limit=200`, `fields=confirmationCode checkIn checkOut listing status guest`
   - (Phone is on the guest object — we request the whole guest.)

3. **Tools: Aggregate to array** — wrap the reservations list into a single iterable.

4. **Iterator (BasicFeeder)** — iterate reservations.

5. **Filter: skip obvious misses** — same date-shape filter as watcher module 4:
   - `confirmationCode != ""`
   - `checkIn matches ^[0-9]{4}-[0-9]{2}-[0-9]{2}`
   - `checkOut matches ^[0-9]{4}-[0-9]{2}-[0-9]{2}`
   - `guest.phones[] is not empty`
   - `status != "canceled"`

6. **Find partner booking in-array**
   - Loop the full reservations list; keep only those where:
     - `listing._id == 3.listing._id`
     - `normalizePhone(guest.phones[0]) == normalizePhone(3.guest.phones[0])`
     - `confirmationCode != 3.confirmationCode`
     - EITHER `substring(checkOut;0;10) == substring(3.checkIn;0;10)` OR `substring(checkIn;0;10) == substring(3.checkOut;0;10)`
   - If zero hits, quit this iteration (Filter gates module 7 downstream).

7. **Monday: find both Cleans rows** — two queries aliased in one mutation:
   ```graphql
   query {
     self: boards(ids:5095134636){ items_page(limit:1 query_params:{rules:[{column_id:"long_text_mm2pedn3" compare_value:"{{3.confirmationCode}}" operator:contains_text}]}){ items{ id } } }
     sibling: boards(ids:5095134636){ items_page(limit:1 query_params:{rules:[{column_id:"long_text_mm2pedn3" compare_value:"{{partner.confirmationCode}}" operator:contains_text}]}){ items{ id } } }
   }
   ```

8. **Monday: write linked ref & note on both** — one aliased mutation:
   ```graphql
   mutation {
     a: change_multiple_column_values(
       board_id:5095134636
       item_id:{{selfId}}
       column_values:"{\"text_mm2qh78j\":\"{{siblingId}}\",\"long_text_mm2qp4ay\":\"Contiguous stay with {{partner.confirmationCode}} — {{formatDate(now;'DD MMM HH:mm')}} UTC\"}"
     ){id}
     b: change_multiple_column_values(
       board_id:5095134636
       item_id:{{siblingId}}
       column_values:"{\"text_mm2qh78j\":\"{{selfId}}\",\"long_text_mm2qp4ay\":\"Contiguous stay with {{3.confirmationCode}} — {{formatDate(now;'DD MMM HH:mm')}} UTC\"}"
     ){id}
   }
   ```

### Why I haven't built this module-by-module yet

I cannot dry-run a Make scenario before it goes live, so any subtle
bundle-shape issue triggers `BundleValidationError` on the first real
firing and silently drops rows (exactly what happened twice with
scenario 9117620). I'd rather ship this once we can walk through the
Guesty response shape together and agree the exact `guest.phones[]`
path — Guesty's docs claim phones is an array of objects with
`{normalized, raw}` but actual payloads vary by listing type.

For now: **rota-planner + staff.html both fully honour `linkedRef`**
— so as soon as you (or I in another pass) populate those columns by
any means (manual, CSV import, this scenario), the UI Just Works.

### Fast manual workaround

You can link a pair immediately from Monday by opening both Cleans rows
and typing the sibling's item id into **Linked ref** on each side.
Optionally set **Linked note** to e.g. `Orphan night — guest extended`
and the UI shows that verbatim.
