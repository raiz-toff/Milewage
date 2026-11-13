package app.milewage.data.pairing

import android.content.Context
import app.milewage.core.api.HttpTransport
import app.milewage.core.api.Settings
import app.milewage.core.connect.HealthProbe
import app.milewage.core.connect.RoutePicker
import app.milewage.core.connect.ServerIdentity
import app.milewage.core.demo.DemoServer
import app.milewage.core.pairing.DeviceSession
import app.milewage.core.pairing.Pairing
import app.milewage.core.pairing.PairingDeps
import app.milewage.core.ports.Clock
import app.milewage.data.connect.AndroidNet
import app.milewage.data.net.HttpClients
import app.milewage.data.net.OkHttpTransport
import app.milewage.data.secure.KeystoreSecretStore

/**
 * The phone's connection to its server, assembled once (one per process, held by the Application):
 * the OkHttp client with the home-only cleartext gate, the network port, the home/away picker, the
 * device session and [pairing]. Requests to the demo's address go to [DemoServer] in this process.
 * The screens use [pairing] (status, redeem, unpair) and [net] (Tailscale); the
 * sending task uses `pairing.session()` for an authenticated client.
 */
class ServerConnection(
    context: Context,
    /** Plain http to any address: debug builds only (`BuildConfig.ANY_HTTP`). */
    anyHttp: Boolean,
    /** `BuildConfig.VERSION_NAME`, sent at pairing. */
    appVersion: String,
    clock: Clock = Clock { System.currentTimeMillis() },
    /** The settings whenever they are stored or loaded (diagnostics level, flags). */
    onSettings: suspend (Settings) -> Unit = {},
    /** Every answer of the paired server after the wrong-server check (the restore-generation check). */
    onAnswer: suspend (ServerIdentity, String?) -> Unit = { _, _ -> },
    /** The demo's in-process server ("Try it without a server"): its address never reaches OkHttp. */
    demo: HttpTransport = DemoServer(clock),
) {
    val transport: HttpTransport = DemoServer.routing(demo, OkHttpTransport(HttpClients.create(anyHttp)))
    val net = AndroidNet(context)
    private val plain = DataStoreKeyValueStore.pairing(context)
    val device = DeviceSession(plain)

    // Home or away for every request (plan 28 section 4.3).
    val route: RoutePicker = RoutePicker(
        localNetwork = { net.localNetwork() },
        probe = HealthProbe.over(transport),
        clock = clock,
    )

    val pairing: Pairing = Pairing(
        PairingDeps(
            secure = KeystoreSecretStore(context),
            plain = plain,
            transport = transport,
            clock = clock,
            appVersion = appVersion,
            route = route,
            anyHttp = anyHttp,
            device = device,
            onSettings = onSettings,
            onAnswer = onAnswer,
        ),
    )
}
