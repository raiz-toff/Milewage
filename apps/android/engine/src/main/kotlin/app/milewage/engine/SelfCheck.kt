// No TypeScript source. A check the app can run on the phone itself (Android's ART, later iOS):
// the unit tests run on a desktop JVM, so this is how the device proves it computes the same
// doubles. Every expected value below was produced by Node v22.22.0 (tools/export-math.ts).
package app.milewage.engine

/**
 * Runs a few of Node's Math.sin / Math.cos / Math.atan2 results and haversine raw doubles,
 * including near-antipodal pairs where one bit changes the decimetres. Returns the failures:
 * an empty list means this runtime matches the server. Cheap (microseconds); a debug screen or
 * a startup log line can call it.
 */
fun engineSelfCheck(): List<String> {
    val failures = ArrayList<String>()
    fun d(hex: String): Double = Double.fromBits(hex.toULong(16).toLong())
    fun bits(x: Double): String = x.toRawBits().toULong().toString(16).padStart(16, '0')
    for (line in MATH) {
        val p = line.split(' ')
        val got = when (p[0]) {
            "sin" -> FdLibm.sin(d(p[1]))
            "cos" -> FdLibm.cos(d(p[1]))
            else -> FdLibm.atan2(d(p[1]), d(p[2]))
        }
        if (bits(got) != p.last()) failures.add("$line got ${bits(got)}")
    }
    for (line in HAVERSINE) {
        val p = line.split(',')
        val raw = haversineRawDm(p[0].toInt(), p[1].toInt(), p[2].toInt(), p[3].toInt())
        if (bits(raw) != p[4] || roundHalfUp(raw) != p[5].toLong()) failures.add("haversine $line got ${bits(raw)}")
    }
    return failures
}

// op, argument bits, [second argument bits,] result bits
private val MATH = listOf(
    "sin 6c806e4325b0e052 3fda42a1c425b576",
    "sin 28b1bf0dfc85df19 28b1bf0dfc85df19",
    "sin 400619c82c938e1a 3fd7ae0037769074",
    "sin 3fd2e2bdbaee7171 3fd29ce13419ad0e",
    "sin 400f6a79ca338ba8 bfe6a09d596c9d7d",
    "sin ff480a28369fffbc bfe7fdc272ab424e",
    "cos 4005d065740010e3 bfed492c1e8948b6",
    "cos c012620f54eb2519 bfbdc9f9ce204f36",
    "cos bf41ddc9472727b3 3fefffffb032c7fc",
    "cos 7af23ca43fb52874 bfcda93e6d2f1e1a",
    "cos 7edf428d2827adb1 bfe83ba6c4e7d8ca",
    "cos bdef7be1caeecb01 3ff0000000000000",
    "atan2 3eb07d44ce1579ca 3fefffffffffef01 3eb07d44ce157cb6",
    "atan2 9c5594c378bbf4b2 32bcbfe48c91ba02 a988056442b518e5",
    "atan2 c6d0710f75c4a25d 0259ae7157558174 bff921fb54442d18",
    "atan2 bff4aafb19200000 4001be0e9f400000 bfe0e08b175a7022",
    "atan2 3fe72a5a8f693974 3fe61387290335c6 3fe9e7290f9285a1",
    "atan2 4004107046100000 bffb65b300200000 40015bd71efbab99",
)

// aLatE7, aLonE7, bLatE7, bLonE7, raw dm bits, haversineDm
private val HAVERSINE = listOf(
    "-220085139,128423257,-220084072,128423370,405dcdcb271ce5fd,119",
    "-807502341,38550270,-807502336,38550177,3ffc0b329ea6464e,2",
    "-247398478,-1208517432,-247523833,-1209308367,40f3cb6fafd7e239,81079",
    "-301781686,1322471521,-130209058,1216606465,4174f2304359dd22,21963524",
    "884368920,295715556,884368214,295714420,4053a511af664473,79",
    "557065010,-1799885686,557115390,1799977177,40c40821e709bb12,10256",
    "-45294,76910028,-44961,76911313,4062735eacaff84c,148",
    "643681543,658217197,-643678462,-1141778929,41a7dc1b9beef8b4,200150478",
    "463685128,-1383952845,-463683094,416049551,41a7dc1c610226d4,200150577",
    "477302267,1043448363,-477303996,-756550668,41a7dc1d0cfdf47e,200150662",
    "-575442795,-1538170212,575442804,261829797,41a7dc1ea7eba015,200150868",
)
