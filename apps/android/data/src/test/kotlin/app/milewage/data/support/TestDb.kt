package app.milewage.data.support

import androidx.room3.Room
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import app.milewage.data.db.DurableDriver
import app.milewage.data.db.MileWageDatabase
import app.milewage.data.db.MileWageDatabase.Companion.configure
import app.milewage.data.db.RoomLocalStore
import java.io.File
import java.nio.file.Files

/**
 * The app's database on the desktop JVM: the same entities, DAOs, journal mode and driver wrapper
 * as on the phone, with the bundled SQLite in place of the platform's (no device here).
 */
object TestDb {
    fun file(): File = Files.createTempDirectory("mw-db").toFile().resolve(MileWageDatabase.FILE_NAME).also { it.deleteOnExit() }

    fun open(path: File = file()): MileWageDatabase =
        Room.databaseBuilder<MileWageDatabase>(path.absolutePath)
            .configure(DurableDriver(BundledSQLiteDriver()))
            .build()

    fun store(path: File = file()): Pair<RoomLocalStore, MileWageDatabase> = open(path).let { RoomLocalStore(it) to it }
}
