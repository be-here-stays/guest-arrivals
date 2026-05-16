# DEPRECATED — Do NOT auto-create Cleans rows from Guesty

> **Status — deprecated as of May 2026.** Any Make scenario based on this
> mapping must be **switched off**. Recreating Cleans rows from new Guesty
> bookings is the wrong architecture and re-introduces a class of bug that
> we explicitly removed (same fix applied to the Hot Tub rota — see
> `hot-tub-rota.html` around `MATERIALISE_ON_SAVE = false`).

## Current architecture (as of May 2026)

- **Arrivals board (`5094453064`)** is the single source of truth for every
  booking. It carries the booking ref, guest name, dates, property, and
  party counts.
- **Rota planner (`rota-planner.html`) derives the rota view directly from
  Arrivals.** Every Arrival that lacks a paired Cleans row renders as a
  **virtual "Tap to plan" card** built on the fly. No Cleans row exists at
  this stage.
- **Cleans board rows (`5095134636`) are materialised only when a job is
  rota'd** — i.e. when at least one cleaner is dragged onto the card and
  the planner clicks Save. This is the same pattern used by Hot Tub Cleans
  and Linen Bags.

## Why creating Cleans rows from Guesty is wrong

- It produces "phantom" Cleans rows that have no cleaner, no hours, and no
  laundry plan. The rota planner treats these as real cleans, so they show
  up twice — once as a virtual derived card and once as the materialised
  empty row — depending on which side resolved first.
- It diverges the Cleans board from the Arrivals board. If a booking is
  cancelled or moved on Arrivals, the orphaned Cleans row remains.
- It creates a dependency: anyone re-running the Make scenario can flood
  the Cleans board with rows that no one asked for.
- The Hot Tub Cleans board hit exactly this issue in early 2026; the fix
  was to stop auto-materialising rows and treat virtual cards as the
  default.

## What to do instead

- **Manual booking ingress (last-minute / fixes) → `guesty-sync.html`.**
  This creates **only** the Arrivals row. The rota planner picks the new
  Arrival up on next refresh and renders a virtual card.
- **Bulk booking ingress (nightly catch-up) → the Make Booking Watcher
  scenario.** This too should write **only** to Arrivals.
- **Rota'ing a job → `rota-planner.html` drag-and-drop.** The planner
  creates the Cleans row at the moment a cleaner is assigned, with the
  Arrival linked via `board_relation_mm31mkyp`.

## Historical column-mapping reference

> Kept for archival reference only. Do **not** use this to wire a new
> scenario — see the section above.

| Guesty field | Cleans column | Column id |
|---|---|---|
| CHECK-IN  | Check-in date | `date_mm2p6tck` |
| CHECK-OUT | Check-out     | `date_mm2pb8rs` |
| CHECK-IN  | Clean date    | `date_mm2pphc`  |
| LISTING   | Property      | `board_relation_mm2psy0b` |

The columns themselves are still in use — but they are populated by
`rota-planner.html` at rota time, drawing the dates from the linked
Arrival row.
