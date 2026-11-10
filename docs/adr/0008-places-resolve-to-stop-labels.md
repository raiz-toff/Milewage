# Named places become stop labels on the server, before the engine runs; a hand label always wins

Drivers stop at the same restaurants, depots and homes again and again, and labelling each stop by hand on the web does not scale (2026-11-10). A **place** is a name, a centre (degrees x 1e7), a radius of 25 to 1000 m (100 m by default) and one of the existing label roles (pickup, dropoff, other). We decided that places are resolved to the engine's existing `stopLabels` input on the server only, just before each engine run, and that the engine is not changed: the server finds the shift's stops with the engine's own stages 1, 2 and 5 (`normalize`, `qualify`, `detectStops`, which read no label), matches each stop to a place, adds a label for every matched stop that has no hand label, and runs `processShift` with the result. Every rule is deterministic:

- A stop is inside a place when the engine's integer `haversineDm` from the centre to the stop's anchor is at most `radius_m * 10` (the edge counts).
- When places overlap, the nearest centre wins; an exact tie goes to the oldest place (the lowest id).
- A hand label always wins over a place. The matched place is still stored on the stop (`stops.place_id`) and its name is shown.
- Places apply where hand labels apply: only while the `stops` module is on and only on shifts cut by stops (`segmenter = 'stops'`, captured at shift start). With the driver's stop detection off, new shifts have no stops, and the places routes answer 404 like the stops routes.
- Adding, changing or deleting a place recomputes, with cause `label`, every ended shift with a stop inside the old or the new circle (or carrying the place). Finalized shifts are never recomputed, and shifts whose raw points were archived cannot be; both keep their figures and are counted as kept in the answer.

## Considered options

- **A new engine input (`places`) matched inside `estimateRoles`**: the Kotlin port would need the same change, the algorithm version would move to 5 and every golden fixture would be regenerated, for a feature the phone never uses (labels are web-only, decision 1.5b).
- **Writing place labels into `stop_labels`**: they would look like the driver's own, could not be told apart or withdrawn when the place is deleted, and would compete in last-writer-wins with real hand labels.
- **Matching at read time only (name shown, no effect on the split)**: half the feature; the label is the point.
- **Running `processShift` twice (once to find stops, once with labels)**: the same answer at twice the cost; stages 1, 2 and 5 are pure exported functions, and a test checks that their stops are the run's stops.

## Consequences

- The input digest includes labels, so a shift with a place-labelled stop has a different digest from the phone's unlabelled run. Labels never change the total, so the comparison at shift end and after is still `match`: exactly what a hand label gives today, not a new difference. When a later recalculation finds a total that differs for another reason, a place label is listed as `edited_on_web`, as a hand label is.
- The server's trips (cut differently) reach the phone through the change feed after every such run; a phone trip edit made on its own cut can become `override_orphaned`, as after a hand label.
- `stops.place_id` (stops migration 0002) records what the last run matched; a finalized shift keeps it, and a deleted place sets it to null. The progress module's delivery count reads hand dropoff labels only; place labels are not counted as deliveries.
- If the engine's stop detection changes, `detectedStopsOf` must keep mirroring `processShift`; the test in `apps/server/test/places.test.ts` fails otherwise.
