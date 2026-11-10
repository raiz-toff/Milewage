package app.milewage.data

import app.milewage.core.api.ApiJson
import app.milewage.core.api.DiagSource
import app.milewage.core.api.Settings
import app.milewage.core.diagnostics.FlushResult
import app.milewage.core.diagnostics.PhoneDiagnostics
import app.milewage.core.ports.Clock
import app.milewage.core.sync.UploadStats
import app.milewage.data.db.RoomLocalStore
import app.milewage.data.support.FakeMileWage
import app.milewage.data.support.Phone
import app.milewage.data.support.TestDb
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.After
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** The phone's diagnostics (a port of the Expo app's diagnostics.test.ts): levels, the allowlist, the ring and sending. */
class DiagnosticsTest {
    private val servers = ArrayList<FakeMileWage>()

    @After
    fun close() = servers.forEach { it.close() }

    private var now = 1_000L

    private fun diag(store: RoomLocalStore = TestDb.store().first, cap: Int = 8_000, pending: Boolean = false) =
        PhoneDiagnostics(store, store, "0.3.0", Clock { now }, { pending }, cap) to store

    private fun settings(level: String, module: Boolean = true, verboseUntil: Long? = null) = ApiJson.decodeFromJsonElement(
        Settings.serializer(),
        JsonObject(
            FakeMileWage.SETTINGS + mapOf(
                "diagnostics" to buildJsonObject { put("level", level); verboseUntil?.let { put("verbose_until", it) } },
                "modules" to buildJsonObject { put("diagnostics", module) },
            ),
        ),
    )

    private val self = buildJsonObject {
        put("dropped", buildJsonObject { put("ring_full", 0); put("schema_reject", 0); put("level_off", 0); put("disk_low", 0) })
        put("pending", 0); put("ring_kb", 0); put("cpu_ms_per_h", 0); put("writes_per_h", 0)
    }

    @Test
    fun offRecordsNothingAndModuleOffOrOffDeletesWhatIsUnsent() = runBlocking {
        val (d, store) = diag()
        assertTrue(d.record("diag.self", self))
        d.applySettings(settings("off"))
        assertEquals(0, store.diagCount())
        assertFalse(d.record("diag.self", self))
        d.applySettings(settings("basic"))
        assertTrue(d.record("diag.self", self))
        d.applySettings(settings("basic", module = false))
        assertEquals(0, store.diagCount())
        assertEquals(app.milewage.core.api.DiagnosticsLevel.OFF, d.effectiveLevel())
    }

    @Test
    fun verboseRevertsToBasicWhenItsExpiryPassesByThePhoneClock() = runBlocking {
        val (d, _) = diag()
        d.applySettings(settings("verbose", verboseUntil = 5_000))
        assertEquals(app.milewage.core.api.DiagnosticsLevel.VERBOSE, d.effectiveLevel())
        now = 5_000
        assertEquals(app.milewage.core.api.DiagnosticsLevel.BASIC, d.effectiveLevel())
    }

    @Test
    fun anUnknownKindAStrayFieldOrAWrongSourceIsRejectedCountedAndNotKept() = runBlocking {
        val (d, store) = diag()
        assertFalse(d.record("made.up", buildJsonObject {}))
        assertFalse(d.record("diag.self", JsonObject(self + ("extra" to JsonPrimitive(1)))))
        assertFalse(d.record("app.start", buildJsonObject {}, src = DiagSource.PHONE_NATIVE))
        assertEquals(0, store.diagCount())
        d.recordSelf()
        val dropped = store.oldestDiag(1).single().second.data["dropped"]!!.jsonObject
        assertEquals(3, dropped["schema_reject"]!!.jsonPrimitive.content.toInt())
    }

    @Test
    fun theAllowlistCanaryNoCoordinatesTokensOrTailnetNamesReachTheRing() = runBlocking {
        val (d, store) = diag()
        fun start(make: String) = buildJsonObject {
            put("app_v", "0.3.0"); put("native_v", "0.3.0"); put("engine_v", "4"); put("api_v", "1")
            put("device", buildJsonObject { put("make", make); put("model", "Pixel 8"); put("android", "16"); put("sdk", 36) })
        }
        assertTrue(d.record("app.start", start("Google")))
        for (hostile in listOf("45.4215296", "123 Main St", "mwd_abc", "box.tail1234.ts.net", "lat 454215296")) {
            assertFalse(d.record("app.start", start(hostile)), hostile)
        }
        assertFalse(d.record("engine.run", buildJsonObject { put("input_digest", "45.4215296") }))
        // A crash keeps method names only, and a message only for allowlisted classes, redacted.
        d.recordCrash(IllegalStateException("at 45.4215296,-75.6971931 token mwd_x"), fatal = false)
        val crash = store.oldestDiag(10).map { it.second }.single { it.kind == "crash" }
        assertFalse(crash.data.containsKey("msg"))
        assertTrue(crash.data["frames"]!!.jsonArray.all { !it.jsonPrimitive.content.contains(".kt") })
        assertFalse(store.oldestDiag(10).joinToString { it.second.data.toString() }.contains("4215296"))
        assertEquals(2, store.diagCount())
    }

    @Test
    fun theRingStaysWithinItsCapDroppingTheCheapKindsFirst() = runBlocking {
        val (d, store) = diag(cap = 5)
        repeat(3) { d.record("diag.self", self) }
        repeat(3) { d.recordUploadWindow(UploadStats(), 0, 0) }
        assertEquals(5, store.diagCount())
        val kinds = store.oldestDiag(10).map { it.second.kind }
        assertEquals(3, kinds.count { it == "diag.self" }) // protected, kept
        assertEquals(2, kinds.count { it == "upload.window" })
    }

    @Test
    fun theRingAndItsSequencePersistAcrossARestart() = runBlocking {
        val file = TestDb.file()
        val (d, _) = diag(RoomLocalStore(TestDb.open(file)))
        d.record("diag.self", self)
        d.record("diag.self", self)
        val again = PhoneDiagnostics(RoomLocalStore(TestDb.open(file)).let { it }, RoomLocalStore(TestDb.open(file)), "0.3.0", Clock { now })
        again.record("diag.self", self)
        val seqs = RoomLocalStore(TestDb.open(file)).oldestDiag(10).map { it.second.seq }
        assertEquals(listOf(1L, 2L, 3L), seqs)
    }

    @Test
    fun aWindowSendsGzippedDeletesWhatWasSentAndWaitsWhileFixesWait() = runBlocking {
        val srv = FakeMileWage().start().also(servers::add)
        val p = Phone(srv)
        p.data.diagnosticsWindow()
        val call = srv.calls.single { it.path == "/diagnostics/events" }
        assertEquals(listOf("upload.window", "diag.self"), (call.body as JsonObject)["events"]!!.jsonArray.map { it.jsonObject["kind"]!!.jsonPrimitive.content })
        assertEquals(0, p.data.store.diagCount())
        // Tax data first: not sent while fixes wait.
        p.data.startShift(3)
        p.record(Phone.drive(2_000, 2))
        p.net.down = true
        p.data.diagnosticsWindow()
        p.net.down = false
        p.data.diagnostics.recordSelf()
        assertEquals(FlushResult.SKIPPED, p.data.diagnostics.flush(p.data.pairing.session()!!.client))
    }

    @Test
    fun theServersAnswersModuleOffRetryAndABadBatchDropped() = runBlocking {
        val srv = FakeMileWage().start().also(servers::add)
        val p = Phone(srv)
        val client = p.data.pairing.session()!!.client
        repeat(250) { p.data.diagnostics.recordSelf() }
        srv.overrides["POST /diagnostics/events"] = { srv.problem(503, "unavailable", true) }
        assertEquals(FlushResult.RETRY, p.data.diagnostics.flush(client))
        assertEquals(250, p.data.store.diagCount())
        srv.overrides["POST /diagnostics/events"] = { srv.problem(422, "validation_failed") }
        assertEquals(FlushResult.SENT, p.data.diagnostics.flush(client))
        assertEquals(50, p.data.store.diagCount()) // a batch is at most 200
        srv.overrides["POST /diagnostics/events"] = { srv.problem(404, "not_found") }
        assertEquals(FlushResult.MODULE_OFF, p.data.diagnostics.flush(client))
        assertEquals(0, p.data.store.diagCount())
        assertFalse(p.data.diagnostics.record("diag.self", self))
    }

    @Test
    fun theTrackersEventsBecomeServiceEventsAndTheRestIsCountedNotStored() = runBlocking {
        val (d, store) = diag()
        val sink = d.trackingSink(CoroutineScope(Dispatchers.Default))
        sink.record("interruption", mapOf("reason" to "service_restarted", "seconds" to "40"))
        sink.record("prompt", mapOf("posted" to "true"))
        delay(300)
        val e = store.oldestDiag(10).single().second
        assertEquals("service.event", e.kind)
        assertEquals(DiagSource.PHONE_NATIVE, e.src)
        assertEquals("restarted", e.data["event"]!!.jsonPrimitive.content)
        assertEquals(JsonArray(emptyList()).size, 0)
    }
}
