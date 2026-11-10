# The gate's minimum move follows the reported accuracy, never below 20 m

Until engine version 3, stage 3 (the gate, `packages/track-engine/src/gate.ts`) counted a fix once it lay at least a fixed 20 m from the anchor, the last accepted fix. A parked phone with poor GPS (say 35 m accuracy) wanders further than that and adds distance that was never driven. From engine version 4 the minimum move for each step is `max(20 m, the worse of the anchor's and the fix's reported accuracy)`, in whole decimetres: `max(200, 10 * max(anchor.accuracyM, fix.accuracyM))`. Stage 2 keeps only fixes with an accuracy of 50 m or better, so the minimum move is between 20 m and 50 m. The owner asked for "whatever is best" on 2026-11-10; this is the conservative choice.

## Why the anchored gate loses no real distance

The gate measures each step as the chord from the anchor, and the anchor moves only when a fix is accepted (`gate()` and `createLiveAccumulator` both set it on `accept` or the first fix only). A fix held back by the larger minimum move does not move the anchor, so the next accepted fix counts the whole chord from the same anchor: the held-back metres are inside that chord. On a straight road the total is exactly the same; the only metres a larger minimum move can leave out are the curve between two counted fixes (chord against arc, over at most 50 m) and the last stretch of the shift that never reaches the minimum move. A slow ride with 35 to 45 m accuracy in the tests loses only its last 40 m.

What "never adds distance" means, precisely:

- From the same anchor, a step the new rule accepts is a step the old rule accepts too (the threshold is never below 200 dm). A test checks this.
- A track whose fixes all report 20 m or better gives the old result bit for bit (same anchors, same steps). Every existing golden fixture is such a track; only their `algorithmVersion` changed.
- A whole shift's total is not guaranteed to be at or below the old rule's, because the anchors fall on different fixes. In 20,000 short random synthetic tracks the new total was higher in about 12%, by at most 39 m (the uncounted tail at the end lands on a different fix); in 3,000 longer ones (20 to 40 legs) it was never higher. Taken over a shift, the change removes distance; it does not reliably add any.

## Considered options

Measured on synthetic tracks (errors consistent with Android's 68% accuracy radius, correlated from fix to fix): a phone parked 10 minutes with 30 to 50 m accuracy, and a city ride at 2 to 6 m/s with 25 to 50 m accuracy and right-angle turns.

| Minimum move                                  | Parked phantom (correlated errors) | Slow poor-accuracy ride, loss against the true length |
| --------------------------------------------- | ---------------------------------- | ----------------------------------------------------- |
| 20 m (version 3)                              | about 290 m per 10 minutes         | 0.8%                                                  |
| `max(20 m, fix accuracy)`                     | about 116 m                        | 2.5%                                                  |
| `max(20 m, worse of anchor and fix)` (chosen) | about 116 m                        | 2.5%                                                  |
| `max(20 m, sqrt(a² + f²))`                    | about 51 m                         | 3.9%                                                  |
| `max(20 m, anchor + fix)`                     | about 8 m                          | 6.0%                                                  |

- The fix's accuracy alone misses a poor anchor: a car that stopped on a 35 m fix and then gets 5 m fixes 30 m away would count 30 m that were not driven. Taking the worse of the two costs nothing when both are good and is symmetric. OpenMiles (`DriveDetector.onDrivingFix`) also scales its step with the fix's accuracy: `max(2.5 × jitter, accuracy)` while lingering and `max(jitter, accuracy / 2)` while moving, in floating point and against the previous point rather than an anchor, so it was a guide, not a copy.
- The sum and the root-sum-square remove more parked wander, but reach 71 m and 100 m, raise the curve and end loss on slow city riding (3.9% and 6.0% against 2.5%), and the root needs an integer square root in every port. Removing most phantom distance without taking real distance was the brief, so they were not chosen. They remain the next step if field data shows parked phantom distance is still common.
- No rule here removes all wander: a stationary phone whose fixes drift further than their own reported accuracy still adds some. The 42 m/s speed bound and stop detection are unchanged.

## Consequences

- `algorithmVersion` is 4. The golden ledgers (`golden.json`, `golden-shift.json`) gained a version 4 entry, a new golden scenario `parked_poor_accuracy` exercises the rule, and the phone's conformance fixtures were regenerated with `npm run conformance:fixtures -w apps/phone`.
- The phone's native notification counter (`LiveDistance.kt`) follows the same rule, so the notification and the app agree.
- Stop detection (stage 5) reads the qualified fixes, not the gated ones, and its 40 m radius is its own; nothing in `stops.ts` reads the minimum move. The `parked_poor_accuracy` scenario finds no stop, because its wander goes past that 40 m radius; stop detection on poor-accuracy fixes is unchanged by this decision and stays open. Gap detection is unchanged too: a fix inside the minimum move still counts as signal (`within_gate` keeps `prevAt`), so a longer minimum move cannot create a gap. `stats.within_gate` keeps its name and now counts the fixes inside the accuracy-aware minimum move.
- Stored shifts keep their figures and their `calc_version` 3. The server works a shift out again only when its points, a label or a trip change, or on `POST /api/v1/shifts/<id>/recalculate`; a finalized shift never. A phone still on version 3 shows `calc_version` as the reason when its total differs from the server's. `milewage-cli recalc --dry-run` lists the shifts whose figures the new engine would change. Trip keys contain the first counted fix's time, so a recomputed shift with a poor-accuracy start can get a new key; a trip edit that no longer matches is flagged `override_orphaned`, as for any recalculation. Raw points of a finalized shift computed with an older version are not archived (the archiver waits for the current `calc_version`).

## For a port of the engine

All values are integers; `accuracyM` is whole metres (the API refuses anything else), distances are decimetres from `haversineDm`.

```
MIN_MOVE_DM = 200
MAX_SPEED_DMPS = 420

minMoveDm(anchor, fix) = max(MIN_MOVE_DM, 10 * max(anchor.accuracyM, fix.accuracyM))

gateStep(anchor, fix):
  if anchor is null:                         return ANCHOR          // first fix: becomes the anchor
  dtMs = fix.recordedAt - anchor.recordedAt
  if dtMs <= 0:                              return DROP(non_positive_dt)
  dDm = haversineDm(anchor, fix)
  if dDm * 1000 > MAX_SPEED_DMPS * dtMs:     return DROP(speed_spike)
  if dDm < minMoveDm(anchor, fix):           return DROP(within_gate)
  return ACCEPT(dDm)                         // caller adds dDm and sets anchor = fix
```

The input to `gateStep` is the stage 2 output (accuracy at most 50 m), so `minMoveDm` is 200 to 500. The comparison is strict (`<`): a step of exactly the minimum move is counted.
