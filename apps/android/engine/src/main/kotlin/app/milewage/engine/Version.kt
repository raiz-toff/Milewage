// Port of packages/track-engine/src/version.ts.
package app.milewage.engine

/**
 * `algorithmVersion` of the TypeScript engine this port matches. Bump whenever the output for
 * any input could change: a threshold, a rule, rounding or a stage (14 section 11). The
 * TypeScript changes first; this follows in the same pull request (README "Changing the engine").
 *
 * History: 1 = stages 1-4 and whole-shift result. 2 = stage 5 stops and the stop-based segmenter.
 * 3 = the estimate: roles from stops and labels, trips cut at state changes. 4 = the gate's
 * minimum move follows accuracy: max(20 m, worse accuracy of anchor and fix) (ADR 0006).
 */
const val ALGORITHM_VERSION: Int = 4
