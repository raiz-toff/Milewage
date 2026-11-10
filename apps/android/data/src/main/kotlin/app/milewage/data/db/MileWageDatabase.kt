package app.milewage.data.db

import android.content.Context
import androidx.room3.Database
import androidx.room3.Entity
import androidx.room3.PrimaryKey
import androidx.room3.Room
import androidx.room3.RoomDatabase
import androidx.sqlite.driver.AndroidSQLiteDriver

/**
 * The phone's database. Empty for now: shifts, fixes, stops and the send queue arrive with the
 * storage task. Room needs at least one table, so the schema starts with [SchemaNote].
 */
@Database(entities = [SchemaNote::class], version = 1, exportSchema = true)
abstract class MileWageDatabase : RoomDatabase() {
    companion object {
        const val FILE_NAME = "milewage.db"

        /** Opens the database on the platform's SQLite (no bundled native library). */
        fun open(context: Context): MileWageDatabase =
            Room.databaseBuilder<MileWageDatabase>(context.applicationContext, FILE_NAME)
                .setDriver(AndroidSQLiteDriver())
                .build()
    }
}

/** Notes about this database file (for example when it was created); a placeholder first table. */
@Entity(tableName = "schema_note")
data class SchemaNote(
    @PrimaryKey val key: String,
    val value: String,
)
