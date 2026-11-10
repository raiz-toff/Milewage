package app.milewage.engine

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** The engine stays plain Kotlin (README rule 1): no Android and no java.* in src/main, so it can become Kotlin Multiplatform commonMain. */
class ModuleRulesTest {
    @Test
    fun noAndroidImports() {
        val main = File("src/main")
        assertTrue(main.isDirectory, "run from the module directory (Gradle does)")
        val offenders = main.walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .filter { file -> file.readLines().map { it.trim() }.any { isPlatformCode(it) } }
            .map { it.path }
            .toList()
        assertEquals(emptyList(), offenders)
    }

    @Test
    fun targetsTheTypeScriptAlgorithmVersion() {
        val ts = File("../../../packages/track-engine/src/version.ts")
        if (!ts.isFile) return // the TypeScript package is not checked out next to this one
        val version = Regex("""algorithmVersion = (\d+)""").find(ts.readText())?.groupValues?.get(1)
        assertEquals(version?.toInt(), Engine.ALGORITHM_VERSION)
    }

    private companion object {
        // Android, and the JVM's own java.* and javax.*, which Kotlin Multiplatform commonMain lacks.
        val PLATFORM_IMPORT = Regex("""^import\s+(android|androidx|com\.google\.android|java|javax)\..*""")
        val QUALIFIED_JAVA = Regex("""(?<![\w.])javax?\.[a-z]""")

        fun isPlatformCode(line: String): Boolean =
            PLATFORM_IMPORT.matches(line) ||
                (!line.startsWith("*") && !line.startsWith("/") && QUALIFIED_JAVA.containsMatchIn(line))
    }
}
