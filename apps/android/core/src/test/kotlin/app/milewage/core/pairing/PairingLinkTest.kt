package app.milewage.core.pairing

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** The cases of packages/shared/test/pairing-link.test.ts, so the phone reads what the server writes. */
class PairingLinkTest {
    private val token = "mwp_" + "a".repeat(43)
    private val away = "https://box.tail1234.ts.net"
    private val home = "http://192.168.1.20:8080"
    private fun enc(s: String) = PairingLinks.encodeUriComponent(s)

    @Test
    fun writesTheAppLinkAndThePageLinkWithHWhenTheHomeAddressDiffers() {
        assertEquals(
            "milewage://pair?v=1&u=${enc(away)}&t=$token&h=${enc(home)}" to "$away/pair#v=1&t=$token&h=${enc(home)}",
            PairingLinks.links(PairingLink(away, token, home)),
        )
    }

    @Test
    fun leavesHOutWhenThereIsNoHomeAddressOrItIsTheAddressInTheCode() {
        val plain = "milewage://pair?v=1&u=${enc(home)}&t=$token" to "$home/pair#v=1&t=$token"
        assertEquals(plain, PairingLinks.links(PairingLink(home, token)))
        assertEquals(plain, PairingLinks.links(PairingLink(home, token, "$home/")))
    }

    @Test
    fun trimsTrailingSlashesAndKeepsAPath() {
        assertEquals("https://a.b:8443/mw/pair#v=1&t=$token", PairingLinks.links(PairingLink("https://a.b:8443/mw/", token)).second)
    }

    @Test
    fun bothFormsReadBackAsWhatWasWritten() {
        val links = listOf(
            PairingLink(away, token),
            PairingLink(away, token, home),
            PairingLink(away, token, "http://milewage.local"),
            PairingLink("https://a.b:8443/mw", token, "http://[fd00::5]:8080"),
            PairingLink(home, "mwp_" + "-_9Zz".repeat(9)),
            PairingLink("http://milewage.home.arpa/sub/dir", "mwp_0123456789"),
        )
        for (link in links) {
            val (app, page) = PairingLinks.links(link)
            assertEquals(link, PairingLinks.parse(app), app)
            assertEquals(link, PairingLinks.parse(page), page)
        }
    }

    @Test
    fun thePageLinkReadOnThePageGivesTheAppLinkTheServerWrote() {
        val written = PairingLinks.links(PairingLink(away, token, home))
        assertEquals(written.first, PairingLinks.links(PairingLinks.parse(written.second)!!).first)
    }

    @Test
    fun trimsATrailingSlashOnUAndSurroundingWhiteSpace() {
        assertEquals(
            PairingLink("https://a.b:8443/mw", token),
            PairingLinks.parse("  milewage://pair?v=1&u=${enc("https://a.b:8443/mw/")}&t=$token\n"),
        )
    }

    @Test
    fun thePageFormTakesItsBaseFromThePageNeverFromASmuggledU() {
        val base = PairingLink(away, token)
        assertEquals(base, PairingLinks.parse("$away/pair#v=1&t=$token"))
        assertEquals(base, PairingLinks.parse("$away/pair/#v=1&t=$token"))
        assertEquals(base, PairingLinks.parse("$away/pair#v=1&t=$token&u=${enc("https://evil.example")}"))
        assertEquals("https://a.b/mw", PairingLinks.parse("https://a.b/mw/pair#v=1&t=$token")?.baseUrl)
    }

    @Test
    fun anHThatIsNotAHomeAddressIsDroppedTheRestKept() {
        for (h in listOf("http://evil.example.com", "https://box.tail1234.ts.net", "http://localhost", "ftp://192.168.1.2", "")) {
            assertEquals(PairingLink(away, token), PairingLinks.parse("milewage://pair?v=1&u=${enc(away)}&t=$token&h=${enc(h)}"), h)
        }
    }

    @Test
    fun rejectsEverythingElse() {
        val bad = listOf(
            "",
            "https://example.com",
            "milewage://pair",
            "milewage://pair?",
            "https://a.b/pair?v=1&t=$token",
            "https://a.b/pairing#v=1&t=$token",
            "https://a.b/pair#v=2&t=$token",
            "https://a.b/pair#t=$token",
            "ftp://a.b/pair#v=1&t=$token",
            "milewage://pair?v=2&u=${enc("https://a.b")}&t=$token",
            "milewage://pair?u=${enc("https://a.b")}&t=$token",
            "milewage://pair?v=1&u=${enc("ftp://a.b")}&t=$token",
            "milewage://pair?v=1&u=${enc("https://a b")}&t=$token",
            "milewage://pair?v=1&u=${enc("https://a.b?x=1")}&t=$token",
            "milewage://pair?v=1&u=&t=$token",
            "milewage://pair?v=1&u=https%3A%2F%2Fa.b&t=mwd_short",
            "milewage://pair?v=1&u=https%3A%2F%2Fa.b&t=mwp_short",
            "milewage://pair?v=1&u=https%3A%2F%2Fa.b&t=mwd_${"a".repeat(43)}",
            "milewage://pair?v=1&u=https%3A%2F%2Fa.b&t=mwp_${"a".repeat(40)}%2B",
            "milewage://pair?v=1&u=https%3A%2F%2Fa.b",
            "milewage://pair?v=1&u=https%3A%2F%2Fa.b&t=$token&broken",
            "milewage://pair?v=1&u=%E0%A4%A&t=x",
            "other://pair?v=1&u=https%3A%2F%2Fa.b&t=$token",
        )
        for (text in bad) assertNull(PairingLinks.parse(text), text)
    }

    @Test
    fun decodesLikeJavaScript() {
        assertEquals("a b/ü", PairingLinks.decodeUriComponent("a%20b%2F%C3%BC"))
        assertEquals("a+b", PairingLinks.decodeUriComponent("a+b")) // + is not a space here
        assertNull(PairingLinks.decodeUriComponent("%E0%A4%A"))
        assertNull(PairingLinks.decodeUriComponent("%ZZ"))
        assertNull(PairingLinks.decodeUriComponent("%C3")) // a lone lead byte
        assertEquals("!'()*~", PairingLinks.encodeUriComponent("!'()*~"))
        assertEquals("http%3A%2F%2F%5Bfd00%3A%3A5%5D%3A8080", PairingLinks.encodeUriComponent("http://[fd00::5]:8080"))
    }

    @Test
    fun incomingLinksAreHandledOnceAndDecidedByTheStatus() {
        val inbox = IncomingLinks()
        val qr = "milewage://pair?v=1&u=${enc("https://mw.example.net")}&t=$token"
        assertEquals(qr, inbox.accept(qr))
        assertNull(inbox.accept(qr)) // the start-up intent and the event: once
        assertNull(inbox.accept("https://example.com"))
        assertNull(inbox.accept(null))
        assertEquals(LinkDecision.Ask(PairingLink("https://mw.example.net", token)), IncomingLinks.decide(qr, PairingStatus.UNPAIRED))
        assertEquals(LinkDecision.Ask(PairingLink("https://mw.example.net", token)), IncomingLinks.decide(qr, PairingStatus.REVOKED))
        assertEquals(LinkDecision.AlreadyConnected, IncomingLinks.decide(qr, PairingStatus.PAIRED))
        assertEquals(LinkDecision.NotAPairingCode, IncomingLinks.decide("hello", PairingStatus.UNPAIRED))
    }
}
