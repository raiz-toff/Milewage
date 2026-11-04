package expo.modules.commatracker

import android.content.Context
import android.database.Cursor
import android.database.DatabaseUtils
import android.database.sqlite.SQLiteDatabase

/** [SqlDb] over Android SQLite. */
class AndroidSqlDb(private val db: SQLiteDatabase) : SqlDb {
    override fun update(sql: String, args: List<Any?>): Int {
        val st = db.compileStatement(sql)
        try {
            args.forEachIndexed { i, a -> DatabaseUtils.bindObjectToProgram(st, i + 1, a) }
            return st.executeUpdateDelete()
        } finally {
            st.close()
        }
    }

    override fun query(sql: String, args: List<Any?>): List<List<Any?>> {
        db.rawQuery(sql, args.map { it?.toString() }.toTypedArray()).use { c ->
            val rows = ArrayList<List<Any?>>()
            while (c.moveToNext()) rows.add((0 until c.columnCount).map { value(c, it) })
            return rows
        }
    }

    override fun <T> transaction(block: () -> T): T {
        db.beginTransaction()
        try {
            val result = block()
            db.setTransactionSuccessful()
            return result
        } finally {
            db.endTransaction()
        }
    }

    private fun value(c: Cursor, i: Int): Any? = when (c.getType(i)) {
        Cursor.FIELD_TYPE_INTEGER -> c.getLong(i)
        Cursor.FIELD_TYPE_FLOAT -> c.getDouble(i)
        Cursor.FIELD_TYPE_STRING -> c.getString(i)
        else -> null
    }

    companion object {
        private var buffer: TrackerBuffer? = null

        /** One buffer per process: the service writes, the module reads and acknowledges. WAL lets both work. */
        @Synchronized
        fun buffer(context: Context): TrackerBuffer {
            buffer?.let { return it }
            val file = context.applicationContext.getDatabasePath("tracker.db")
            file.parentFile?.mkdirs()
            val sqlite = SQLiteDatabase.openOrCreateDatabase(file, null)
            sqlite.enableWriteAheadLogging()
            return TrackerBuffer(AndroidSqlDb(sqlite)).also { buffer = it }
        }
    }
}
