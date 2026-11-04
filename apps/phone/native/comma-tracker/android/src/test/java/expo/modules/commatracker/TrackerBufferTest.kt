package expo.modules.commatracker

import java.sql.Connection
import java.sql.DriverManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** SqlDb over plain JDBC so the buffer's SQL semantics run in a local JUnit test. */
class JdbcSqlDb(private val conn: Connection = DriverManager.getConnection("jdbc:sqlite::memory:")) : SqlDb {
    override fun update(sql: String, args: List<Any?>): Int =
        conn.prepareStatement(sql).use { st ->
            args.forEachIndexed { i, a -> st.setObject(i + 1, a) }
            st.executeUpdate()
        }

    override fun query(sql: String, args: List<Any?>): List<List<Any?>> =
        conn.prepareStatement(sql).use { st ->
            args.forEachIndexed { i, a -> st.setObject(i + 1, a) }
            val rs = st.executeQuery()
            val rows = ArrayList<List<Any?>>()
            while (rs.next()) {
                rows.add((1..rs.metaData.columnCount).map { c ->
                    when (val v = rs.getObject(c)) {
                        is Int -> v.toLong()
                        else -> v
                    }
                })
            }
            rows
        }

    override fun <T> transaction(block: () -> T): T {
        conn.autoCommit = false
        try {
            val r = block()
            conn.commit()
            return r
        } catch (e: Throwable) {
            conn.rollback()
            throw e
        } finally {
            conn.autoCommit = true
        }
    }
}

class TrackerBufferTest {
    private lateinit var buffer: TrackerBuffer

    @Before
    fun setUp() {
        buffer = TrackerBuffer(JdbcSqlDb())
    }

    private fun point(t: Long, speed: Long? = null) =
        BufferPoint(0, "shift-1", t, 436_500_000, -796_000_000, 8, speed, null, null)

    @Test
    fun seqIsStrictlyIncreasingAndNeverReused() {
        val a = buffer.insert(point(1))
        val b = buffer.insert(point(2))
        assertEquals(listOf(a, b), buffer.readPending(10).map { it.seq })
        assertTrue(b > a)
        buffer.markRejected(listOf(b), "x", 10)
        assertTrue(buffer.insert(point(3)) > b)
    }

    @Test
    fun readPendingIsOldestFirstAndLimited() {
        repeat(5) { buffer.insert(point(it.toLong())) }
        assertEquals(listOf(0L, 1L, 2L), buffer.readPending(3).map { it.recordedAt })
        assertEquals(436_500_000L, buffer.readPending(1)[0].latE7)
    }

    private fun pointOf(shift: String, t: Long) = point(t).copy(shiftClientId = shift)

    @Test
    fun readByShiftReturnsPendingAndUploadedRowsOfOneShiftInOrder() {
        val a1 = buffer.insert(pointOf("a", 1))
        buffer.insert(pointOf("b", 2))
        val a2 = buffer.insert(pointOf("a", 3))
        val a3 = buffer.insert(pointOf("a", 4))
        buffer.markUploaded(listOf(a1, a2), 100)
        assertEquals(listOf(a1, a2, a3), buffer.readByShift("a", 0, 10).map { it.seq })
        assertEquals(listOf(a3), buffer.readPending(10).map { it.seq }.filter { it == a3 })
        assertEquals(listOf(a2, a3), buffer.readByShift("a", a1, 10).map { it.seq })
        assertEquals(listOf(a1), buffer.readByShift("a", 0, 1).map { it.seq })
        assertEquals(emptyList<Long>(), buffer.readByShift("none", 0, 10))
        assertEquals(emptyList<Long>(), buffer.readByShift("a", 0, 0))
    }

    @Test
    fun readByShiftLeavesRowsUntouchedAndSkipsQuarantineAndEvictedRows() {
        val a = buffer.insert(pointOf("a", 1))
        val b = buffer.insert(pointOf("a", 2))
        val c = buffer.insert(pointOf("a", 3))
        buffer.markUploaded(listOf(a), 100)
        buffer.markRejected(listOf(b), "bad", 5)
        buffer.evictUploaded(1_000)
        assertEquals(listOf(c), buffer.readByShift("a", 0, 10).map { it.seq })
        assertEquals(listOf(c), buffer.readByShift("a", 0, 10).map { it.seq }) // reading changes nothing
        assertEquals(listOf(c), buffer.readPending(10).map { it.seq })
    }

    @Test
    fun everyFixIsStoredUnfilteredWithNullableFields() {
        buffer.insert(point(1, speed = 12))
        buffer.insert(point(1)) // same time and place: no dedupe or distance filter here
        val p = buffer.readPending(10)
        assertEquals(2, p.size)
        assertEquals(12L, p[0].speedDmps)
        assertNull(p[1].speedDmps)
    }

    @Test
    fun markUploadedKeepsRowsButLeavesPending() {
        val s = (1..3L).map { buffer.insert(point(it)) }
        assertEquals(2, buffer.markUploaded(listOf(s[0], s[1]), 1_000))
        assertEquals(listOf(s[2]), buffer.readPending(10).map { it.seq })
        assertEquals(0, buffer.markUploaded(listOf(s[0]), 2_000)) // already uploaded: unchanged
    }

    @Test
    fun evictDeletesOnlyUploadedRowsOlderThanTheCutoff() {
        val old = buffer.insert(point(1))
        val recent = buffer.insert(point(2))
        val pending = buffer.insert(point(3))
        buffer.markUploaded(listOf(old), 1_000)
        buffer.markUploaded(listOf(recent), 5_000)
        assertEquals(1, buffer.evictUploaded(2_000))
        assertEquals(1, buffer.evictUploaded(Long.MAX_VALUE))
        // A PENDING row survives every eviction, even with the largest cutoff.
        assertEquals(listOf(pending), buffer.readPending(10).map { it.seq })
    }

    @Test
    fun markRejectedMovesPendingRowsToQuarantine() {
        val a = buffer.insert(point(1))
        val b = buffer.insert(point(2))
        buffer.markUploaded(listOf(a), 1)
        assertEquals(1, buffer.markRejected(listOf(a, b), "bad", 9)) // uploaded rows are not touched
        assertEquals(1L, buffer.quarantinedCount())
        assertEquals(emptyList<Long>(), buffer.readPending(10).map { it.seq })
    }

    @Test
    fun largeSeqListsAreChunked() {
        val seqs = (1..1000L).map { buffer.insert(point(it)) }
        assertEquals(1000, buffer.markUploaded(seqs, 1))
    }
}

class PointMapperTest {
    @Test
    fun convertsToStoredUnits() {
        val p = PointMapper.toPoint("s", 5, 43.65, -79.38, 7.6f, 3.26f, 181.4f, 76.5)
        assertEquals(436_500_000L, p.latE7)
        assertEquals(-793_800_000L, p.lonE7)
        assertEquals(8L, p.accuracyM)
        assertEquals(33L, p.speedDmps)
        assertEquals(181L, p.bearingDeg)
        assertEquals(77L, p.altitudeM)
    }

    @Test
    fun missingValuesStayNullAndAccuracyIsPessimistic() {
        val p = PointMapper.toPoint("s", 5, 0.0, 0.0, null, null, null, null)
        assertEquals(PointMapper.UNKNOWN_ACCURACY_M, p.accuracyM)
        assertNull(p.speedDmps)
        assertNull(p.altitudeM)
    }

    @Test
    fun gnssOffsetIsFixTimeMinusNow() {
        assertEquals(-1500L, PointMapper.gnssOffsetMs(10_000, 11_500))
    }
}
