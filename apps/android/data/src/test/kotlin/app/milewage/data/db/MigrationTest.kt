package app.milewage.data.db

import androidx.room3.useReaderConnection
import androidx.sqlite.SQLiteConnection
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import app.milewage.core.pairing.Credential
import app.milewage.core.shift.SendState
import app.milewage.core.sync.ServerBinding
import app.milewage.data.support.TestDb
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Every migration against the exported schema it starts from: a database built only from the
 * committed `N.json`, with rows, opened by the current code. Room runs the migration and then checks
 * the result against the current entities (every table, column, index and foreign key), so a
 * migration that leaves anything different fails here.
 */
class MigrationTest {
    private fun SQLiteConnection.exec(sql: String) = prepare(sql).use { it.step() }

    /** A version [version] database at [file], from `data/schemas`, and [rows] run on it. */
    private fun create(file: File, version: Int, rows: List<String>) {
        val json = Json.parseToJsonElement(File("schemas/app.milewage.data.db.MileWageDatabase/$version.json").readText()).jsonObject
        val database = json["database"]!!.jsonObject
        val c = BundledSQLiteDriver().open(file.absolutePath)
        for (e in database["entities"]!!.jsonArray) {
            val name = e.jsonObject["tableName"]!!.jsonPrimitive.content
            c.exec(e.jsonObject["createSql"]!!.jsonPrimitive.content.replace("\${TABLE_NAME}", name))
            e.jsonObject["indices"]?.jsonArray?.forEach { i -> c.exec(i.jsonObject["createSql"]!!.jsonPrimitive.content.replace("\${TABLE_NAME}", name)) }
        }
        for (q in database["setupQueries"]!!.jsonArray) c.exec(q.jsonPrimitive.content)
        c.exec("PRAGMA user_version = $version")
        for (r in rows) c.exec(r)
        c.close()
    }

    private fun shiftRow(id: String, sync: String = "local") =
        """INSERT INTO shifts (client_id, server_id, vehicle_id, status, segmenter, started_at, ended_at, local_date, total_m, calc_source,
           recon_status, recon_reasons_json, auto_closed, updated_at, sync_state, server_deduction_known, server_has_other_shift)
           VALUES ('$id', NULL, 3, 'ended', 'stops', 1000, 9000, '2026-11-01', 4321, 'phone', 'pending', '[]', 0, 1, '$sync', 0, 0)"""

    private val version1Rows = listOf(
        shiftRow("a"),
        shiftRow("b", sync = "on_server"),
        "INSERT INTO fixes (shift_client_id, recorded_at, lat_e7, lon_e7, accuracy_m, send_state) VALUES ('a', 1000, 400000000, 0, 5, 0)",
        "INSERT INTO fixes (shift_client_id, recorded_at, lat_e7, lon_e7, accuracy_m, send_state) VALUES ('a', 2000, 400010000, 0, 5, 0)",
        "INSERT INTO outbox (kind, entity_key, shift_client_id, body, created_at, attempts, status) VALUES ('shift.create', 'a', 'a', '{}', 5, 0, 'pending')",
        "INSERT INTO odometer_readings (shift_client_id, kind, reading_m, recorded_at, server_id, sync_state) VALUES ('a', 'shift_start', 50000, 1000, NULL, 'local')",
        "INSERT INTO bookkeeping (`key`, value) VALUES ('shift.lastVehicle', '3')",
    )

    private fun credential(instance: String) = Credential("http://192.168.1.20:8080", deviceId = 1, deviceToken = "mwd_x", instanceId = instance)

    @Test
    fun version1RowsSurviveUnboundAndTheServerPairedNowClaimsThem() = runBlocking {
        val file = TestDb.file()
        create(file, 1, version1Rows)
        val db = TestDb.open(file) // migrates 1 to 2, then validates against the entities
        val store = RoomLocalStore(db)
        assertEquals("2", db.useReaderConnection { c -> c.usePrepared("PRAGMA user_version") { st -> st.step(); st.getText(0) } })
        val a = store.shift("a")!!
        assertNull(a.instanceId)
        assertEquals(4321L, a.distances!!.totalM)
        assertEquals(SendState.SENT, store.shift("b")!!.sendState)
        assertEquals(2L, store.pendingCount("a"))
        assertEquals(1, store.pendingChanges().size)
        assertEquals(50_000L, store.odometer("a").single().readingM)
        assertEquals("3", store.get("shift.lastVehicle"))
        val indexes = db.useReaderConnection { c ->
            c.usePrepared("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'shifts'") { st -> buildList { while (st.step()) add(st.getText(0)) } }
        }
        assertTrue("index_shifts_instance_id_server_id" in indexes, indexes.toString())
        assertTrue("index_shifts_server_id" !in indexes, indexes.toString())

        // The phone is paired at the update: the rows are that server's.
        val binding = ServerBinding(store) { credential("inst-A") }
        binding.settle()
        assertEquals(listOf("inst-A", "inst-A"), listOf("a", "b").map { store.shift(it)!!.instanceId })
        assertEquals(1, binding.view.pendingChanges().size)
        assertEquals(2L, binding.view.pendingCount())
        assertEquals("192.168.1.20", store.get(ServerBinding.hostKey("inst-A")))
        db.close()
    }

    @Test
    fun unpairedAtTheUpdateTheyWaitForTheFirstServerPaired() = runBlocking {
        val file = TestDb.file()
        create(file, 1, version1Rows)
        val store = RoomLocalStore(TestDb.open(file))
        var paired: Credential? = null
        val binding = ServerBinding(store) { paired }
        binding.settle()
        assertNull(store.shift("a")!!.instanceId)
        paired = credential("inst-B")
        binding.settle()
        assertEquals("inst-B", store.shift("a")!!.instanceId)
        // Claimed once: a later server does not take them.
        paired = credential("inst-C")
        binding.settle()
        assertEquals("inst-B", store.shift("a")!!.instanceId)
        assertEquals(emptyList(), binding.view.pendingChanges())
    }
}
