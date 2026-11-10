package app.milewage.phone.logic

import app.milewage.core.api.ApiCodes
import app.milewage.core.api.ApiException
import app.milewage.core.connect.AddressProblem
import app.milewage.core.connect.ConnectFailure
import app.milewage.core.pairing.PairingLink
import app.milewage.core.pairing.PairingLinks
import app.milewage.phone.support.CREDENTIAL
import app.milewage.phone.support.PAIRED_STATE
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

private const val TOKEN = "mwp_abcdefghijklmnop"

private fun code(base: String, home: String? = null) = PairingLinks.links(PairingLink(base, TOKEN, home)).first

/** What the driver types, pastes or scans on Connect (the Expo app's connect and pairing.screen tests). */
class ConnectInputTest {
    @Test
    fun `either form of a pairing code is a code to redeem`() {
        val app = code("https://box.tail1234.ts.net", "http://192.168.1.20:8080")
        assertEquals(ConnectInput.Code(PairingLink("https://box.tail1234.ts.net", TOKEN, "http://192.168.1.20:8080")), ConnectInput.read(app, release = true))
        val page = "https://box.tail1234.ts.net/pair#v=1&t=$TOKEN"
        assertIs<ConnectInput.Code>(ConnectInput.read("  $page\n", release = true))
    }

    @Test
    fun `a code from localhost is refused before anything is sent, always`() {
        assertEquals(ConnectInput.Refused(AddressProblem.THIS_COMPUTER), ConnectInput.read(code("http://localhost:3000"), release = false))
        assertEquals(ConnectInput.Refused(AddressProblem.THIS_COMPUTER), ConnectInput.read(code("http://127.0.0.1:3000"), release = true))
    }

    @Test
    fun `plain http outside the home network is refused in a release build only`() {
        val http = code("http://milewage.example.com")
        assertEquals(ConnectInput.Refused(AddressProblem.INSECURE_OUTSIDE_HOME), ConnectInput.read(http, release = true))
        assertIs<ConnectInput.Code>(ConnectInput.read(http, release = false))
        assertIs<ConnectInput.Code>(ConnectInput.read(code("http://192.168.1.20:8080"), release = true))
    }

    @Test
    fun `a typed server address links with a code, http only at home`() {
        assertEquals(ConnectInput.Address("http://192.168.1.20:8080"), ConnectInput.read("192.168.1.20:8080", release = true))
        assertEquals(ConnectInput.Address("http://box.local:8080"), ConnectInput.read("box.local:8080/", release = true))
        assertEquals(ConnectInput.Address("https://box.tail1234.ts.net"), ConnectInput.read("box.tail1234.ts.net", release = true))
        assertEquals(ConnectInput.Address("https://box.tail1234.ts.net"), ConnectInput.read("https://box.tail1234.ts.net/", release = true))
        assertEquals(ConnectInput.Refused(AddressProblem.INSECURE_OUTSIDE_HOME), ConnectInput.read("http://milewage.example.com", release = true))
        assertEquals(ConnectInput.Refused(AddressProblem.THIS_COMPUTER), ConnectInput.read("localhost:3200", release = true))
    }

    @Test
    fun `anything else is not a code`() {
        listOf("", "hello", "milewage", "mwp_abcdefghijklmnop", "milewage://pair?v=2&u=x&t=y", "two words.com").forEach {
            assertEquals(ConnectInput.NotACode, ConnectInput.read(it, release = true), it)
        }
    }

    @Test
    fun `a scan of a stray code says no, a pairing code goes on trimmed`() {
        assertEquals(ScanResult.Stray, ScanResult.of("https://example.com/menu"))
        assertEquals(ScanResult.Code(code("https://box.tail1234.ts.net")), ScanResult.of(" " + code("https://box.tail1234.ts.net") + " "))
    }
}

/**
 * Every failure says what is wrong and leads somewhere (the Expo app's connect and deadends tests):
 * each `Reach` answer has a way forward, and Tailscale is offered only where it can help.
 */
class ConnectErrorTest {
    private fun api(code: String, status: Int = 0) = ApiException(status, code, false)

    @Test
    fun `says which step is wrong when connecting fails`() = runTest {
        val home = "http://192.168.1.20:8080"
        val tailnet = "https://box.tail1234.ts.net"
        assertEquals(ConnectError.Failed(ConnectFailure.HomeUnreachable(home)), ConnectError.of(api(ApiCodes.NETWORK), home) { error("not asked at home") })
        assertEquals(ConnectError.Failed(ConnectFailure.TailscaleOff), ConnectError.of(api(ApiCodes.NETWORK), tailnet) { false })
        assertEquals(ConnectError.Failed(ConnectFailure.TailnetNotAnswering), ConnectError.of(api(ApiCodes.NETWORK), tailnet) { true })
        assertEquals(ConnectError.Failed(ConnectFailure.TailscaleUnknown), ConnectError.of(api(ApiCodes.NETWORK), tailnet) { null })
        assertEquals(ConnectError.Failed(ConnectFailure.Unreachable), ConnectError.of(api(ApiCodes.NETWORK), "https://milewage.example.com") { true })
        assertEquals(ConnectError.Failed(ConnectFailure.InvalidCode), ConnectError.of(api(ApiCodes.INVALID_PAIRING_TOKEN, 401), tailnet) { null })
        assertEquals(ConnectError.Failed(ConnectFailure.RateLimited), ConnectError.of(api(ApiCodes.RATE_LIMITED, 429), tailnet) { null })
        assertEquals(ConnectError.Failed(ConnectFailure.NotMileWage), ConnectError.of(api(ApiCodes.NOT_MILEWAGE, 200), tailnet) { null })
        assertEquals(ConnectError.Failed(ConnectFailure.InsecureAddress), ConnectError.of(api(ApiCodes.INSECURE_ADDRESS), tailnet) { null })
        assertEquals(ConnectError.Failed(ConnectFailure.Other), ConnectError.of(api("server_error", 500), tailnet) { null })
        assertEquals(ConnectError.Failed(ConnectFailure.Other), ConnectError.of(IllegalStateException("x"), tailnet) { null })
        assertEquals(ConnectError.AppTooOld, ConnectError.of(api(ApiCodes.UPGRADE_REQUIRED, 426), tailnet) { null })
    }

    @Test
    fun `no dead ends - every connect error has one way forward, Tailscale only when it helps`() {
        val all = listOf(
            ConnectError.NotACode,
            ConnectError.AppTooOld,
            ConnectError.Address(AddressProblem.THIS_COMPUTER),
            ConnectError.Address(AddressProblem.INSECURE_OUTSIDE_HOME),
            ConnectError.Failed(ConnectFailure.HomeUnreachable("http://192.168.1.20")),
            ConnectError.Failed(ConnectFailure.TailscaleOff),
            ConnectError.Failed(ConnectFailure.TailnetNotAnswering),
            ConnectError.Failed(ConnectFailure.TailscaleUnknown),
            ConnectError.Failed(ConnectFailure.InvalidCode),
            ConnectError.Failed(ConnectFailure.RateLimited),
            ConnectError.Failed(ConnectFailure.NotMileWage),
            ConnectError.Failed(ConnectFailure.Unreachable),
            ConnectError.Failed(ConnectFailure.InsecureAddress),
            ConnectError.Failed(ConnectFailure.Other),
        )
        all.forEach { e ->
            val tailscale = e is ConnectError.Failed && e.failure.offerTailscale
            assertEquals(tailscale, e.fix == ConnectFix.OPEN_TAILSCALE, "$e")
        }
        // A bad or used code: make a new one and scan it.
        assertEquals(ConnectFix.SCAN, ConnectError.Failed(ConnectFailure.InvalidCode).fix)
        assertEquals(ConnectFix.SCAN, ConnectError.NotACode.fix)
    }

    @Test
    fun `linking failures in words, by the server's code`() {
        assertEquals(LinkFailure.EXPIRED, LinkFailure.of(ApiException(410, ApiCodes.LINK_EXPIRED, false)))
        assertEquals(LinkFailure.RATE_LIMITED, LinkFailure.of(ApiException(429, ApiCodes.RATE_LIMITED, true)))
        assertEquals(LinkFailure.UNREACHABLE, LinkFailure.of(ApiException(0, ApiCodes.NETWORK, true)))
        assertEquals(LinkFailure.NOT_SUPPORTED, LinkFailure.of(ApiException(404, "not_found", false)))
        assertEquals(LinkFailure.APP_TOO_OLD, LinkFailure.of(ApiException(426, ApiCodes.UPGRADE_REQUIRED, false)))
        assertEquals(LinkFailure.OTHER, LinkFailure.of(RuntimeException()))
    }
}

class ServerFactsTest {
    @Test
    fun `host names only, both addresses, and what the server sent`() {
        val f = ServerFacts.of(PAIRED_STATE)
        assertEquals("box.tail1234.ts.net", f.host)
        assertEquals("192.168.1.20", f.homeHost)
        assertEquals("box.tail1234.ts.net", f.awayHost)
        assertEquals("Sam", f.name)
        assertEquals("CA", f.country)
        assertEquals("ON", f.region)
        assertEquals(false, f.homeOnly)
        listOf(f.host, f.homeHost, f.awayHost).forEach { assertTrue("mwd_" !in it!! && "http" !in it) }
    }

    @Test
    fun `only a home address - works on the home Wi-Fi, Tailscale later`() {
        val home = PAIRED_STATE.copy(credential = CREDENTIAL.copy(baseUrl = "http://192.168.1.20:8080", awayUrl = null), settings = null)
        val f = ServerFacts.of(home)
        assertEquals(true, f.homeOnly)
        assertEquals("192.168.1.20", f.host)
        assertNull(f.awayHost)
        assertNull(f.name)
        assertNull(f.country)
    }

    @Test
    fun `a phone from before plan 28 reads its one address as home or away`() {
        val away = ServerFacts.of(PAIRED_STATE.copy(credential = CREDENTIAL.copy(homeUrl = null, awayUrl = null)))
        assertEquals("box.tail1234.ts.net", away.awayHost)
        assertNull(away.homeHost)
    }
}

class SettingsLogicTest {
    @Test
    fun `help opens through the address in use, away first when unknown`() {
        assertEquals("http://192.168.1.20:8080/help", HelpLinks.url(CREDENTIAL, app.milewage.core.connect.Where.HOME, HelpLinks.Page.INDEX))
        assertEquals("https://box.tail1234.ts.net/help/troubleshooting", HelpLinks.url(CREDENTIAL, app.milewage.core.connect.Where.AWAY, HelpLinks.Page.TROUBLESHOOTING))
        assertEquals("https://box.tail1234.ts.net/help/getting-started", HelpLinks.url(CREDENTIAL, null, HelpLinks.Page.GETTING_STARTED))
        val homeOnly = CREDENTIAL.copy(baseUrl = "http://192.168.1.20:8080", awayUrl = null)
        assertEquals("http://192.168.1.20:8080/help/phones-and-devices", HelpLinks.url(homeOnly, null, HelpLinks.Page.PHONES))
    }

    @Test
    fun `the reminder's choices are Off and the tracker's allowed range, plus an odd stored value`() {
        assertEquals(listOf(0, 15, 30, 45, 60, 90, 120), NudgeChoices.of(30 * 60_000L))
        assertEquals(listOf(0, 15, 30, 45, 60, 90, 120, 200), NudgeChoices.of(200 * 60_000L))
        NudgeChoices.minutes.forEach { NudgeChoices.ms(it) } // each is accepted by TrackingSettings
        app.milewage.core.tracking.TrackingSettings(nudgeAfterMs = NudgeChoices.ms(120))
    }
}
