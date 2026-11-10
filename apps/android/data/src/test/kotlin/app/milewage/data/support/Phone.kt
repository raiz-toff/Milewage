package app.milewage.data.support

import app.milewage.core.api.ApiJson
import app.milewage.core.api.HttpRequest
import app.milewage.core.api.HttpResponse
import app.milewage.core.api.HttpTransport
import app.milewage.core.api.Settings
import app.milewage.core.api.TransportFailure
import app.milewage.core.pairing.Credential
import app.milewage.core.pairing.MemoryStore
import app.milewage.core.pairing.Pairing
import app.milewage.core.pairing.PairingDeps
import app.milewage.core.ports.Clock
import app.milewage.core.shift.BatteryReading
import app.milewage.core.shift.Recorder
import app.milewage.core.tracking.Interruption
import app.milewage.core.tracking.RecordedFix
import app.milewage.data.MileWageData
import app.milewage.data.db.MileWageDatabase
import app.milewage.data.net.HttpClients
import app.milewage.data.net.OkHttpTransport
import app.milewage.data.sync.SendScheduler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import java.io.File

class TestClock(var t: Long) : Clock {
    override fun nowMs(): Long = t
}

/** The tracker, faked: what the shift model asked of it. */
class FakeRecorder : Recorder {
    var recordingId: String? = null
    var refuse = false
    val interruptionsById = HashMap<String, List<Interruption>>()
    var offset: Long? = null

    override suspend fun start(shiftClientId: String, startedAt: Long): Boolean {
        if (refuse) return false
        recordingId = shiftClientId
        return true
    }

    override suspend fun stop() {
        recordingId = null
    }

    override suspend fun recording(): String? = recordingId

    override suspend fun interruptions(shiftClientId: String) = interruptionsById[shiftClientId] ?: emptyList()

    override fun gnssOffsetMs(): Long? = offset
}

/** The connection switch: down, every request gets no answer (no network, server off, Tailscale off). */
class Switch(private val inner: HttpTransport) : HttpTransport {
    @Volatile var down = false

    override suspend fun exchange(request: HttpRequest): HttpResponse {
        if (down) throw TransportFailure.NoAnswer()
        return inner.exchange(request)
    }
}

/**
 * A paired phone against [server]: the real database (JVM SQLite), the real HTTP client over
 * OkHttp, the real pairing and device session, with a test clock, fixed ids and a fake tracker.
 * [dbFile] lets a second phone object open the same database (an app restart).
 */
class Phone(
    val server: FakeMileWage,
    val dbFile: File = TestDb.file(),
    val clock: TestClock = TestClock(1_000),
    ids: List<String> = listOf(ID),
    paired: Boolean = true,
    settings: Settings = ApiJson.decodeFromJsonElement(Settings.serializer(), FakeMileWage.SETTINGS),
    val secure: MemoryStore = MemoryStore(),
    val plain: MemoryStore = MemoryStore(),
    val recorder: FakeRecorder = FakeRecorder(),
    var battery: BatteryReading? = null,
) {
    val net = Switch(OkHttpTransport(HttpClients.create(anyHttp = true)))
    val db: MileWageDatabase = TestDb.open(dbFile)
    private var next = 0
    private val idList = ids

    val data: MileWageData = MileWageData.assemble(
        db = db,
        connect = { onAnswer, onSettings ->
            Pairing(PairingDeps(secure, plain, net, clock, "0.3.0", anyHttp = true, onAnswer = onAnswer, onSettings = onSettings))
        },
        recorder = recorder,
        scheduler = SendScheduler.None,
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
        clock = clock,
        appVersion = "0.3.0",
        battery = { battery },
        newId = { idList[minOf(next++, idList.size - 1)] },
        rand = { 0.5 },
    )

    init {
        if (paired) runBlocking { pair(settings) }
    }

    suspend fun pair(settings: Settings = ApiJson.decodeFromJsonElement(Settings.serializer(), FakeMileWage.SETTINGS)) {
        secure.put(Pairing.KEY_CREDENTIAL, ApiJson.encodeToString(Credential.serializer(), Credential(server.url, deviceId = 1, deviceToken = "mwd_test", instanceId = "inst-A")))
        plain.put(Pairing.KEY_SETTINGS, ApiJson.encodeToString(Settings.serializer(), settings))
    }

    /** Stores fixes for the running shift as the tracker would. */
    suspend fun record(fixes: List<RecordedFix>): List<RecordedFix> = data.fixStore.append(data.shifts.running()!!.clientId, fixes)

    companion object {
        const val ID = "11111111-1111-4111-8111-111111111111"
        const val B = "22222222-2222-4222-8222-222222222222"

        fun sid(i: Int) = "00000000-0000-4000-8000-${i.toString().padStart(12, '0')}"

        /** [n] good fixes from [from], every [stepMs], [stepE7] apart northwards (about 11 m per 1,000 E7). */
        fun drive(from: Long, n: Int, stepMs: Long = 10_000, stepE7: Long = 10_000, startLat: Long = 400_000_000): List<RecordedFix> =
            (0 until n).map { i ->
                val t = from + i * stepMs
                RecordedFix(0, "", t, startLat + i * stepE7, 0, 5, null, null, null, "gps", null, t)
            }
    }
}
