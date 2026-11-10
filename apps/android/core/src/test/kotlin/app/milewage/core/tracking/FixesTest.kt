package app.milewage.core.tracking

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

fun raw(
    timeMs: Long = 5,
    lat: Double = 43.65,
    lon: Double = -79.38,
    accuracyM: Float? = 7.6f,
    speedMps: Float? = 3.26f,
    bearingDeg: Float? = 181.4f,
    altitudeM: Double? = 76.5,
    provider: String = RawLocation.GPS,
    elapsedRealtimeMs: Long? = null,
) = RawLocation(provider, timeMs, elapsedRealtimeMs, lat, lon, accuracyM, speedMps, bearingDeg, altitudeM)

/** Ported from the Expo tracker's PointMapperTest, plus the local-only fields. */
class FixMapperTest {
    @Test
    fun convertsToStoredUnits() {
        val p = FixMapper.toRecordedFix("s", raw(), phoneTimeMs = 6)!!
        assertEquals(0L, p.seq)
        assertEquals("s", p.shiftClientId)
        assertEquals(5L, p.recordedAt)
        assertEquals(436_500_000L, p.latE7)
        assertEquals(-793_800_000L, p.lonE7)
        assertEquals(8L, p.accuracyM)
        assertEquals(33L, p.speedDmps)
        assertEquals(181L, p.bearingDeg)
        assertEquals(77L, p.altitudeM)
        assertEquals("gps", p.provider)
        assertEquals(6L, p.phoneTimeMs)
    }

    @Test
    fun missingValuesStayNullAndAccuracyIsPessimistic() {
        val p = FixMapper.toRecordedFix("s", raw(lat = 0.0, lon = 0.0, accuracyM = null, speedMps = null, bearingDeg = null, altitudeM = null), null)!!
        assertEquals(RecordedFix.UNKNOWN_ACCURACY_M, p.accuracyM)
        assertNull(p.speedDmps)
        assertNull(p.bearingDeg)
        assertNull(p.altitudeM)
    }

    @Test
    fun roundsHalfUpLikeTheEngine() {
        // 0.5 e7 units rounds up, -0.5 rounds toward +infinity (Math.round / roundHalfUp).
        assertEquals(1L, FixMapper.toE7(0.00000005))
        assertEquals(0L, FixMapper.toE7(-0.00000005))
        val p = FixMapper.toRecordedFix("s", raw(accuracyM = 2.5f, speedMps = 0.25f, bearingDeg = 359.5f, altitudeM = -0.5), null)!!
        assertEquals(3L, p.accuracyM)
        assertEquals(3L, p.speedDmps)
        assertEquals(360L, p.bearingDeg) // as the Expo tracker stored it
        assertEquals(0L, p.altitudeM)
    }

    @Test
    fun valuesThatAreNotFiniteAreUnknownInsteadOfLosingTheFix() {
        val p = FixMapper.toRecordedFix("s", raw(accuracyM = Float.NaN, speedMps = Float.POSITIVE_INFINITY, altitudeM = Double.NaN), null)!!
        assertEquals(RecordedFix.UNKNOWN_ACCURACY_M, p.accuracyM)
        assertNull(p.speedDmps)
        assertNull(p.altitudeM)
        assertNull(FixMapper.toRecordedFix("s", raw(lat = Double.NaN), null))
        assertNull(FixMapper.toRecordedFix("s", raw(lat = 91.0), null))
    }

    @Test
    fun gnssOffsetIsFixTimeMinusPhoneTimeAtTheFix() {
        assertEquals(-1500L, FixMapper.gnssOffsetMs(10_000, 11_500))
        // Delivered 30 s late in a batch: the phone time at the fix, not at delivery.
        val late = raw(timeMs = 1_000_000, elapsedRealtimeMs = 50_000)
        val phoneAtFix = late.phoneTimeAt(nowWallMs = 1_030_200, nowElapsedMs = 80_000)
        assertEquals(1_000_200L, phoneAtFix)
        assertEquals(-200L, FixMapper.gnssOffsetMs(late.timeMs, phoneAtFix))
    }

    @Test
    fun phoneTimeFallsBackToNowWithoutAMonotonicStamp() {
        assertEquals(77L, raw(elapsedRealtimeMs = null).phoneTimeAt(77, 5))
        assertEquals(77L, raw(elapsedRealtimeMs = 10).phoneTimeAt(77, 5)) // a stamp from the future
    }

    @Test
    fun clockSkewIsTheMedianOverGnssFixesOnly() {
        fun f(provider: String, recordedAt: Long, phone: Long?) =
            RecordedFix(0, "s", recordedAt, 0, 0, 5, null, null, null, provider, null, phone)
        val fixes = listOf(
            f("gps", 1_000, 1_300), // +300
            f("gps", 2_000, 2_100), // +100
            f("gps", 3_000, 3_200), // +200
            f("gps", 4_000, 4_900), // +900
            f("network", 5_000, 5_000), // phone clock: ignored
            f("gps", 6_000, null), // no phone time: ignored
        )
        assertEquals(200L, ClockSkew.medianPhoneMinusGnssMs(fixes)) // lower middle of 100,200,300,900
        assertNull(ClockSkew.medianPhoneMinusGnssMs(fixes.filter { it.provider == "network" }))
    }

    @Test
    fun duplicateFilterDropsTheSameFixDeliveredTwice() {
        val d = DuplicateFilter(remember = 2)
        val a = raw(timeMs = 1)
        assertTrue(d.isNew(a))
        assertFalse(d.isNew(a.copy(provider = "gps")), "the passive copy of our own gps fix")
        assertTrue(d.isNew(a.copy(provider = "network")))
        assertTrue(d.isNew(a.copy(timeMs = 2)))
        assertTrue(d.isNew(a), "forgotten after `remember` newer ones")
    }
}

class SnapshotTest {
    @Test
    fun roundTripsValuesWithLineBreaksAndBackslashes() {
        val text = Snapshot.Builder().put("a", 1L).put("b", "x\ny\\z=w").put("c", true).put("d", null).encode()
        val s = Snapshot.decode(text)
        assertEquals(1L, s.long("a"))
        assertEquals("x\ny\\z=w", s.string("b"))
        assertEquals(true, s.bool("c"))
        assertNull(s.string("d"))
    }

    @Test
    fun damagedTextGivesNothingInsteadOfThrowing() {
        val s = Snapshot.decode("garbage\n=x\nn=notanumber")
        assertNull(s.long("n"))
        assertNull(s.string("garbage"))
        assertNull(Snapshot.decode(null).string("a"))
    }

    @Test
    fun samplesRoundTripExactly() {
        val list = listOf(
            Sample(raw(timeMs = 1, lat = 51.50123456789, lon = -0.1234567, elapsedRealtimeMs = 99), 1_234),
            Sample(raw(accuracyM = null, speedMps = null, bearingDeg = null, altitudeM = null, provider = "net,work;"), 5),
        )
        val back = Snapshot.decodeSamples(Snapshot.encodeSamples(list))
        assertEquals(list[0], back[0])
        assertEquals("network", back[1].raw.provider)
        assertNull(back[1].raw.accuracyM)
        assertEquals(emptyList(), Snapshot.decodeSamples("1,2,3"))
    }
}
