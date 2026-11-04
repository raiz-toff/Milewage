/**
 * Bump whenever the output for any input could change: a threshold, a rule,
 * rounding or a stage (14 section 11). Pure refactors do not bump it.
 *
 * History: 1 = stages 1-4 and whole-shift result. 2 = stage 5 stops and the stop-based segmenter
 * (output for `segmenter: 'stops'` inputs changed; every `whole_shift` output is unchanged).
 */
export const algorithmVersion = 2;
