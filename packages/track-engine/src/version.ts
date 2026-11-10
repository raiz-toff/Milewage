/**
 * Bump whenever the output for any input could change: a threshold, a rule,
 * rounding or a stage (14 section 11). Pure refactors do not bump it.
 *
 * History: 1 = stages 1-4 and whole-shift result. 2 = stage 5 stops and the stop-based segmenter
 * as a list of facts (output for `segmenter: 'stops'` inputs changed).
 * 3 = the estimate: roles from stops and labels, trips cut at state changes, `no_stops_detected`,
 * `long_stop`, `label_orphaned` (output for `'stops'` inputs with stops changed; `whole_shift`
 * outputs are unchanged apart from the version field).
 * 4 = the gate's minimum move follows accuracy: max(20 m, worse accuracy of anchor and fix)
 * (ADR 0006). Output changes only where a fix or its anchor reports an accuracy over 20 m.
 */
export const algorithmVersion = 4;
