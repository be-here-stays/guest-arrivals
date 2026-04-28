# Make scenario: Guesty → Cleans board

When a new booking flows in from the Guesty CSV, Make should create ONE item on the Cleans board (id 5095134636) per booking. Column mapping:

| Guesty field | Cleans column | Column id | Notes |
|---|---|---|---|
| CHECK-IN (date) | Check-in date | `date_mm2p6tck` | The immovable right-end anchor of the drag window |
| CHECK-OUT (date) | Check-out | `date_mm2pb8rs` | This booking's own check-out; read by the NEXT clean at the same property to set its earliest drag day |
| CHECK-IN (date) | Clean date | `date_mm2pphc` | The scheduled day of the clean — initial value = CHECK-IN. Cleaners can later drag this backwards toward the prior guest's check-out. |
| LISTING (property name) | Property | `board_relation_mm2psy0b` | Match to Properties board item and link via `{ "item_ids": [<id>] }` |

## Item name
Format as `"<Short day> <DD> · <property short name>"` — e.g. `"Thu 30 · Firefly"`. The frontend parses this if the Property relation is missing.

## Do NOT populate
- `date_mm2phd58` (Earliest) — deprecated; rota-planner now derives the earliest from the prior sibling clean's Check-out column. Leave empty on all new items.
- `color_mm2prq2f` (Status) — leave empty. Planner sets it to "Unassigned" / "Planned" as cleaners get assigned.
- Cleaner, hours, times — all set by the planner.
- `color_mm2pnast` (Laundry run) + `dropdown_mm2ptbe7` (Laundry driver) — legacy single-field columns, being phased out. New cleans should leave these empty.
- Linen-in / Dirties-out columns (see below) — all housekeeping-managed, not populated from Guesty.

## Laundry columns (planner-managed, not from Guesty)

Added for the two-event laundry flow:

| Column | Column id | Type | Purpose |
|---|---|---|---|
| Linen-in method | `color_mm2pgdm5` | status | Laundry van / Maintenance team / Management / Cleaner |
| Linen-in driver | `dropdown_mm2pmr0f` | dropdown | Named person delivering (when not the van) |
| Linen-in date | `date_mm2phz49` | date | Delivery day; may be earlier than clean day |
| Linen source property | `board_relation_mm2pke5q` | board_relation | Sibling property where clean linen is left for cleaners to collect |
| Dirties-out method | `color_mm2pd9tb` | status | Same options as Linen-in. Always happens before next check-in. |
| Dirties-out driver | `dropdown_mm2pwdwg` | dropdown | Named person collecting dirties |

## Quality Check rule

If `color_mm2pznw1` (Check type) is `Quality Check` (i.e. Guest Ready is not ticked), the rota-planner now REQUIRES a checker to be assigned before save. There is no middle ground — checker is either not required (Guest Ready) or mandatory (Quality Check).

## How the frontend uses these

The rota-planner walks the Cleans list for each open clean `C` and finds the most recent prior clean `S` at the same property whose scheduled day is earlier than `C.checkinDate`. It then pulls `S.checkoutDate` as the earliest day `C` can be dragged back to. This means:

- Each booking's departure naturally caps the next booking's movable window.
- No back-fill of "previous guest's check-out" onto each row is needed — the data is already on the prior row.
- If a property has no prior clean in the loaded window, the earliest falls back to the legacy `CL_EARLIEST` column, then to the clean's own check-in.
