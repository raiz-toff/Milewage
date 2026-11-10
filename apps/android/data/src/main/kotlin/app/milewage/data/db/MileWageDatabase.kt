package app.milewage.data.db

import android.content.Context
import androidx.room3.Database
import androidx.room3.Room
import androidx.room3.RoomDatabase
import androidx.room3.migration.Migration
import androidx.sqlite.SQLiteConnection
import androidx.sqlite.SQLiteDriver
import androidx.sqlite.SQLiteStatement
import androidx.sqlite.driver.AndroidSQLiteDriver
import androidx.sqlite.execSQL

/**
 * The phone's database: every shift, fix, result, edit, reading and queued change (15 section 2.2).
 * The native app starts with an empty one (no import from the Expo app's SQLite files: the driver
 * pairs again, and data the Expo app had not sent must be sent before updating; see the release
 * notes). Schemas are exported to `data/schemas/` and committed; every later version adds a
 * `Migration` tested against them (`MigrationTest`).
 *
 * Write-ahead logging, foreign keys on, and `synchronous = FULL` ([DurableDriver]): a commit is on
 * the storage before the call returns, also across a power loss, so what the screens show as saved
 * is saved.
 */
@Database(
    entities = [
        ShiftEntity::class,
        FixEntity::class,
        InterruptionEntity::class,
        TripEntity::class,
        StopEntity::class,
        RouteEntity::class,
        OdometerEntity::class,
        VehicleEntity::class,
        OutboxEntity::class,
        OverwriteEntity::class,
        ResendEntity::class,
        BookkeepingEntity::class,
        DiagEventEntity::class,
    ],
    version = MileWageDatabase.VERSION,
    exportSchema = true,
)
abstract class MileWageDatabase : RoomDatabase() {
    abstract fun dao(): StoreDao

    companion object {
        const val FILE_NAME = "milewage.db"
        const val VERSION = 2

        /**
         * 1 to 2: every shift is bound to the server it was recorded for (`shifts.instance_id`, see
         * `ServerBinding` in :core), and a server id is unique per server (`(instance_id, server_id)`
         * replaces the unique `server_id`). Rows from version 1 stay unbound (null): the binding claims them
         * for the server paired now as soon as the app starts paired (or for the first server paired
         * after it), so nothing recorded before is lost or sent anywhere else.
         */
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override suspend fun migrate(connection: SQLiteConnection) {
                connection.execSQL("ALTER TABLE `shifts` ADD COLUMN `instance_id` TEXT")
                // Server ids are unique per server (two servers both have a shift 100).
                connection.execSQL("DROP INDEX IF EXISTS `index_shifts_server_id`")
                connection.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS `index_shifts_instance_id_server_id` ON `shifts` (`instance_id`, `server_id`)")
            }
        }

        /** Migrations from each exported version, each tested against its schema (`MigrationTest`). */
        val MIGRATIONS = arrayOf<Migration>(MIGRATION_1_2)

        /** Opens the database on the platform's SQLite (no bundled native library). */
        fun open(context: Context): MileWageDatabase =
            Room.databaseBuilder<MileWageDatabase>(context.applicationContext, FILE_NAME)
                .configure(DurableDriver(AndroidSQLiteDriver()))
                .build()

        /** The builder settings every database of the app uses (tests open one on the desktop JVM). */
        fun RoomDatabase.Builder<MileWageDatabase>.configure(driver: SQLiteDriver): RoomDatabase.Builder<MileWageDatabase> =
            setDriver(driver)
                .setJournalMode(JournalMode.WRITE_AHEAD_LOGGING)
                .addMigrations(*MIGRATIONS)
    }
}

/**
 * A driver that keeps every connection at `PRAGMA synchronous = FULL` and foreign keys on. Room sets
 * `synchronous = NORMAL` with write-ahead logging; NORMAL survives an app crash but may lose the
 * last commits on a power loss or a kernel crash. A courier's phone can die on a dead battery
 * mid-shift, and a fix or an edit reported as saved must be saved, so this driver turns that one
 * statement into FULL: one more sync of the log per commit, at a commit every 5 to 15 seconds.
 */
class DurableDriver(private val delegate: SQLiteDriver) : SQLiteDriver {
    override val hasConnectionPool: Boolean get() = delegate.hasConnectionPool

    override fun open(fileName: String): SQLiteConnection {
        val c = Durable(delegate.open(fileName))
        c.exec("PRAGMA foreign_keys = ON")
        c.exec("PRAGMA synchronous = FULL")
        return c
    }

    private class Durable(private val c: SQLiteConnection) : SQLiteConnection {
        override fun inTransaction(): Boolean = c.inTransaction()

        override fun prepare(sql: String): SQLiteStatement {
            val s = sql.trim().replace(Regex("\\s+"), " ")
            return c.prepare(if (s.equals("PRAGMA synchronous = NORMAL", ignoreCase = true)) "PRAGMA synchronous = FULL" else sql)
        }

        override fun close() = c.close()

        fun exec(sql: String) {
            val st = c.prepare(sql)
            try {
                st.step()
            } finally {
                st.close()
            }
        }
    }
}
