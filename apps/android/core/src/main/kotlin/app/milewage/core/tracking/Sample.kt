package app.milewage.core.tracking

/**
 * A raw fix as the state machines see it: the platform sample plus [atMs], the phone's wall clock
 * at the fix ([RawLocation.phoneTimeAt]). The machines run on that one clock, so their timers and
 * the fixes agree even when the GNSS time and the phone's clock differ (clock skew), and their
 * snapshots survive a reboot (the monotonic clock restarts at zero; the wall clock does not).
 */
data class Sample(val raw: RawLocation, val atMs: Long) {
    val latE7: Long = FixMapper.toE7(raw.lat)
    val lonE7: Long = FixMapper.toE7(raw.lon)

    /** Metres; unknown is infinitely bad. */
    val accuracyM: Double = raw.accuracyM?.takeIf { it.isFinite() && it >= 0f }?.toDouble() ?: Double.POSITIVE_INFINITY

    /** Reported speed in m/s, or null. */
    val speedMps: Double? = raw.speedMps?.takeIf { it.isFinite() && it >= 0f }?.toDouble()

    /** Good enough to judge movement: the engine's stage 2 limit (50 m). */
    val qualified: Boolean get() = accuracyM <= QUALIFIED_ACCURACY_M

    fun metresTo(o: Sample): Double = Geo.metres(latE7, lonE7, o.latE7, o.lonE7)

    companion object {
        const val QUALIFIED_ACCURACY_M = 50.0

        /** Usable coordinates only; null otherwise. */
        fun of(raw: RawLocation, atMs: Long): Sample? {
            if (!raw.lat.isFinite() || !raw.lon.isFinite()) return null
            if (raw.lat !in -90.0..90.0 || raw.lon !in -180.0..180.0) return null
            return Sample(raw, atMs)
        }
    }
}
