// The engine's front door (packages/track-engine/src/index.ts exports the same functions).
package app.milewage.engine

/**
 * The track engine, a port of `packages/track-engine`, bit for bit with the TypeScript.
 *
 * What the other modules call:
 * - [processShift]: a finished shift's trips, stops, totals, route, flags and input digest;
 *   [canonicalJson] of the result is the byte form the server compares.
 * - [createLiveAccumulator]: the running total while a shift records.
 * - [measureDistance]: stages 1-3 only (distance, accepted fixes, drop counts).
 * - [lastFixEnd]: the end to offer for a shift the app has to close itself.
 * - [degToE7] / [e7ToDeg]: Location degrees to the engine's integers and back.
 * - [haversineDm]: the engine's distance between two points, in decimetres.
 * - [engineSelfCheck]: run on the device, proves the runtime computes Node's doubles.
 *
 * Every top-level function of this package is pure: no clock, no randomness, no I/O.
 */
object Engine {
    /** `algorithmVersion` of packages/track-engine/src/version.ts that this port matches. */
    const val ALGORITHM_VERSION: Int = app.milewage.engine.ALGORITHM_VERSION

    fun processShift(input: ShiftInput): ShiftResult = app.milewage.engine.processShift(input)

    fun canonicalJson(result: ShiftResult): String = app.milewage.engine.canonicalJson(result)

    fun measureDistance(fixes: List<Fix>, startedAt: Long, endedAt: Long): GateResult =
        app.milewage.engine.measureDistance(fixes, startedAt, endedAt)

    fun createLiveAccumulator(startedAt: Long): LiveAccumulator = app.milewage.engine.createLiveAccumulator(startedAt)

    fun lastFixEnd(fixes: List<Fix>, startedAt: Long): Long? = app.milewage.engine.lastFixEnd(fixes, startedAt)

    /** Empty when this runtime computes the same doubles as the server's Node; else the failures. */
    fun selfCheck(): List<String> = engineSelfCheck()
}
