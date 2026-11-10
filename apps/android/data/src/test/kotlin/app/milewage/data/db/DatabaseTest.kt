package app.milewage.data.db

import androidx.room3.useReaderConnection
import androidx.room3.useWriterConnection
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import app.milewage.core.api.ChangeType
import app.milewage.core.api.Segmenter
import app.milewage.core.api.TripKind
import app.milewage.core.shift.OdometerKind
import app.milewage.core.shift.OdometerRecord
import app.milewage.core.shift.SendState
import app.milewage.core.shift.ShiftRecord
import app.milewage.core.shift.ShiftStatus
import app.milewage.core.shift.TripRecord
import app.milewage.core.shift.TripSource
import app.milewage.core.sync.ResendMark
import app.milewage.core.sync.Retention
import app.milewage.core.tracking.RecordedFix
import app.milewage.data.support.TestDb
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The phone's database on the JVM: tables, pragmas, cascades, the fix store, the outbox and the retention rule. */
class DatabaseTest {
    private val day = 86_400_000L

    private fun shift(id: String, status: ShiftStatus = ShiftStatus.ENDED, send: SendState = SendState.ON_PHONE_ONLY) = ShiftRecord(
        clientId = id, vehicleId = 3, status = status, segmenter = Segmenter.STOPS, startedAt = 1_000, endedAt = 9_000,
        localDate = "2026-11-01", updatedAt = 1, sendState = send,
    )

    private fun fix(t: Long) = RecordedFix(0, "", t, 400_000_000, 0, 5, null, null, null, "gps", null, t)

    private suspend fun MileWageDatabase.pragma(name: String): String =
        useReaderConnection { c -> c.usePrepared("PRAGMA $name") { st -> st.step(); st.getText(0) } }

    @Test
    fun opensWithWalForeignKeysAndFullSyncAndSurvivesAReopen() = runBlocking {
        val file = TestDb.file()
        val db = TestDb.open(file)
        val store = RoomLocalStore(db)
        store.upsertShift(shift("a"))
        assertEquals("wal", db.pragma("journal_mode"))
        // synchronous = FULL (2) on the writer, the connection every commit goes through.
        assertEquals("2", db.useWriterConnection { c -> c.usePrepared("PRAGMA synchronous") { st -> st.step(); st.getText(0) } })
        assertEquals("1", db.useWriterConnection { c -> c.usePrepared("PRAGMA foreign_keys") { st -> st.step(); st.getText(0) } })
        assertEquals("1", db.pragma("user_version"))
        val tables = db.useReaderConnection { c ->
            c.usePrepared("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name") { st ->
                buildList { while (st.step()) add(st.getText(0)) }
            }
        }
        assertTrue(
            tables.containsAll(
                listOf("shifts", "fixes", "interruptions", "trips", "stops", "routes", "odometer_readings", "vehicles", "outbox", "overwrite_log", "resend_marks", "bookkeeping", "diag_events"),
            ),
            tables.toString(),
        )
        db.close()
        val again = RoomLocalStore(TestDb.open(file))
        assertEquals("a", again.shift("a")?.clientId)
    }

    @Test
    fun aShiftDeletedOnTheServerTakesEverythingOfItAndNothingElse() = runBlocking {
        val (store, _) = TestDb.store()
        store.upsertShift(shift("a"))
        store.upsertShift(shift("b"))
        for (id in listOf("a", "b")) {
            store.upsertTrip(TripRecord("$id:1:active", id, kind = TripKind.ACTIVE, originalKind = TripKind.ACTIVE, source = TripSource.AUTO, startedAt = 1, endedAt = 2, distanceM = 10, purpose = ""))
            store.upsertOdometer(OdometerRecord(id, OdometerKind.SHIFT_START, 1, 1))
            store.fixes.append(id, listOf(fix(1_000), fix(2_000)))
        }
        store.markForResend(listOf("a")) { ResendMark(it, 2, ResendMark.Phase.TODO, 0) }
        store.deleteShift("a")
        assertNull(store.shift("a"))
        assertEquals(emptyList(), store.trips("a"))
        assertEquals(emptyList(), store.odometer("a"))
        assertEquals(emptyList(), store.fixes.fixesFor("a"))
        assertEquals(emptyList(), store.resendMarks())
        assertEquals(1, store.trips("b").size)
        assertEquals(2, store.fixes.fixesFor("b").size)
    }

    @Test
    fun fixSeqsStrictlyIncreaseAcrossShiftsAndAreNeverReused() = runBlocking {
        val (store, _) = TestDb.store()
        val a = store.fixes.append("a", listOf(fix(1), fix(2), fix(3)))
        val b = store.fixes.append("b", listOf(fix(4)))
        assertEquals(listOf(1L, 2L, 3L, 4L), (a + b).map { it.seq })
        assertEquals(listOf("a", "a", "a", "b"), (a + b).map { it.shiftClientId })
        assertEquals(3L, store.fixes.lastSeq("a"))
        store.deleteShift("b")
        assertEquals(5L, store.fixes.append("c", listOf(fix(5))).single().seq) // AUTOINCREMENT: 4 is not reused
        assertEquals(listOf(1L, 2L, 3L), store.fixes.fixesFor("a").map { it.seq })
        // The local-only fields come back.
        assertEquals("gps", store.fixes.fixesFor("a").first().provider)
        assertEquals(1L, store.fixes.fixesFor("a").first().phoneTimeMs)
    }

    @Test
    fun setAsideFixesAreKeptButLeaveTheResultAndTheManifest() = runBlocking {
        val (store, _) = TestDb.store()
        store.fixes.append("a", listOf(fix(1), fix(2), fix(3)))
        assertEquals(3L, store.pendingCount("a"))
        assertEquals(1, store.setAside(listOf(2), "invalid", 10))
        assertEquals(2, store.markSent(listOf(1, 2, 3), 10)) // a set-aside fix is not marked sent
        assertEquals(listOf(1L, 3L), store.fixes.fixesFor("a").map { it.seq })
        assertEquals(app.milewage.core.api.PointManifest(1, 3, 2), store.manifest("a"))
        assertEquals(0L, store.pendingCount())
    }

    @Test
    fun retentionDeletesOnlyOldSentFixesOfConfirmedShifts() = runBlocking {
        val (store, _) = TestDb.store()
        val now = 100 * day
        store.upsertShift(shift("sent", send = SendState.SENT))
        store.upsertShift(shift("young", send = SendState.SENT))
        store.upsertShift(shift("unsent"))
        store.upsertShift(shift("queued", send = SendState.SENT))
        store.upsertShift(shift("running", status = ShiftStatus.RUNNING, send = SendState.SENT))
        store.upsertShift(shift("resend", send = SendState.SENT))
        for (id in listOf("sent", "young", "unsent", "queued", "running", "resend")) {
            val f = store.fixes.append(id, listOf(fix(1), fix(2)))
            store.markSent(listOf(f[0].seq), if (id == "young") now - 13 * day else now - 15 * day)
        }
        store.insertChange(ChangeType.TRIP_OVERRIDE, "queued:1:active", JsonObject(emptyMap()), 1)
        store.markForResend(listOf("resend")) { ResendMark(it, 2, ResendMark.Phase.TODO, 0) }
        assertEquals(1, store.evictSent(Retention.cutoff(now)))
        assertEquals(1, store.fixes.fixesFor("sent").size) // the pending one stays
        for (id in listOf("young", "unsent", "queued", "running", "resend")) assertEquals(2, store.fixes.fixesFor(id).size, id)
        assertFalse(Retention.allowed(restored = true, resendWaiting = false))
        assertFalse(Retention.allowed(restored = false, resendWaiting = true))
    }

    @Test
    fun anAnsweredOutboxRowIsKeptWhenAnEditReplacedItsBodyMeanwhile() = runBlocking {
        val (store, _) = TestDb.store()
        val body = JsonObject(mapOf("reading_m" to JsonPrimitive(1)))
        val id = store.insertChange(ChangeType.ODOMETER_PUT, "a:shift_end", body, 5)
        val sent = store.pendingChanges().single()
        store.replaceChange(id, JsonObject(mapOf("reading_m" to JsonPrimitive(2))))
        store.deleteSentChange(id, sent.body)
        assertEquals(2, store.pendingChanges().single().body["reading_m"]!!.jsonPrimitive.content.toInt())
        store.deleteSentChange(id, store.pendingChanges().single().body)
        assertEquals(0, store.changeCounts().pending)
    }

    @Test
    fun resendMarksAreSwappedOnlyWhenUnchanged() = runBlocking {
        val (store, _) = TestDb.store()
        store.markForResend(listOf("a")) { ResendMark(it, 2, ResendMark.Phase.TODO, 0) }
        val m = store.resendMark("a")!!
        assertTrue(store.swapResendMark(m, m.copy(afterSeq = 500)))
        assertFalse(store.swapResendMark(m, m.copy(afterSeq = 900))) // a restore in between wins
        assertFalse(store.dropResendMark(m))
        assertTrue(store.dropResendMark(m.copy(afterSeq = 500)))
    }

    /**
     * The exported schema (data/schemas, committed) is what this code expects: a database built only
     * from the JSON's SQL opens in Room, whose schema validation compares every table, column, index
     * and foreign key with the entities, and its identity hash with the code's.
     */
    @Test
    fun theExportedSchemaOpensInRoom() = runBlocking {
        val json = Json.parseToJsonElement(File("schemas/app.milewage.data.db.MileWageDatabase/${MileWageDatabase.VERSION}.json").readText()).jsonObject
        val database = json["database"]!!.jsonObject
        assertEquals(MileWageDatabase.VERSION, database["version"]!!.jsonPrimitive.content.toInt())
        val file = TestDb.file()
        val c = BundledSQLiteDriver().open(file.absolutePath)
        fun exec(sql: String) = c.prepare(sql).use { it.step() }
        for (e in database["entities"]!!.jsonArray) {
            val name = e.jsonObject["tableName"]!!.jsonPrimitive.content
            exec(e.jsonObject["createSql"]!!.jsonPrimitive.content.replace("\${TABLE_NAME}", name))
            e.jsonObject["indices"]?.jsonArray?.forEach { i -> exec(i.jsonObject["createSql"]!!.jsonPrimitive.content.replace("\${TABLE_NAME}", name)) }
        }
        for (q in database["setupQueries"]!!.jsonArray) exec(q.jsonPrimitive.content)
        exec("PRAGMA user_version = ${MileWageDatabase.VERSION}")
        c.close()
        val store = RoomLocalStore(TestDb.open(file)) // throws if the schema or its hash differ
        store.upsertShift(shift("x"))
        assertEquals("x", store.shifts().single().clientId)
    }
}
