package expo.modules.commatracker

/** Minimal SQL seam so the buffer logic runs on Android SQLite and, in JUnit, on plain JDBC. */
interface SqlDb {
    /** Runs one statement; returns the number of changed rows. */
    fun update(sql: String, args: List<Any?> = emptyList()): Int
    /** Rows as positional values (Long, Double, String or null). */
    fun query(sql: String, args: List<Any?> = emptyList()): List<List<Any?>>
    fun <T> transaction(block: () -> T): T
}

/** One fix as stored: the wire shape of 08 section 5 plus the local shift id (02 section 3.1). */
data class BufferPoint(
    val seq: Long,
    val shiftClientId: String,
    val recordedAt: Long,
    val latE7: Long,
    val lonE7: Long,
    val accuracyM: Long,
    val speedDmps: Long?,
    val bearingDeg: Long?,
    val altitudeM: Long?,
)

/**
 * The native-owned telemetry buffer (`tracker.db`, 02 section 3.1, 15 section 2.1).
 * Every fix is written; nothing is filtered here. Points are identified by their `seq`.
 */
class TrackerBuffer(private val db: SqlDb) {
    init {
        db.update(
            """CREATE TABLE IF NOT EXISTS telemetry_buffer (
                seq INTEGER PRIMARY KEY AUTOINCREMENT, shift_client_id TEXT NOT NULL,
                recorded_at INTEGER NOT NULL, lat_e7 INTEGER NOT NULL, lon_e7 INTEGER NOT NULL,
                accuracy_m INTEGER NOT NULL, speed_dmps INTEGER, bearing_deg INTEGER, altitude_m INTEGER,
                sync_status TEXT NOT NULL DEFAULT 'PENDING', uploaded_at INTEGER)"""
        )
        db.update("CREATE INDEX IF NOT EXISTS idx_telemetry_sync ON telemetry_buffer(sync_status, seq)")
        db.update("CREATE INDEX IF NOT EXISTS idx_telemetry_evict ON telemetry_buffer(sync_status, uploaded_at)")
        db.update("CREATE INDEX IF NOT EXISTS idx_telemetry_shift ON telemetry_buffer(shift_client_id, seq)")
        db.update(
            """CREATE TABLE IF NOT EXISTS telemetry_quarantine (
                seq INTEGER PRIMARY KEY, shift_client_id TEXT NOT NULL, recorded_at INTEGER NOT NULL,
                lat_e7 INTEGER NOT NULL, lon_e7 INTEGER NOT NULL, reason TEXT NOT NULL,
                quarantined_at INTEGER NOT NULL)"""
        )
    }

    /** Appends a fix as PENDING; returns the device-assigned `seq` (strictly increasing, never reused). */
    fun insert(p: BufferPoint): Long = db.transaction {
        db.update(
            "INSERT INTO telemetry_buffer (shift_client_id, recorded_at, lat_e7, lon_e7, accuracy_m, " +
                "speed_dmps, bearing_deg, altitude_m) VALUES (?,?,?,?,?,?,?,?)",
            listOf(p.shiftClientId, p.recordedAt, p.latE7, p.lonE7, p.accuracyM, p.speedDmps, p.bearingDeg, p.altitudeM),
        )
        db.query("SELECT last_insert_rowid()")[0][0] as Long
    }

    /** Oldest PENDING points first, at most [limit]. */
    fun readPending(limit: Int): List<BufferPoint> = read(
        "WHERE sync_status = 'PENDING'", emptyList(), limit,
    )

    /**
     * Rows of one shift with `seq` above [afterSeq], PENDING and UPLOADED alike, oldest first, at
     * most [limit]. Quarantined rows are not in the buffer. Used to rebuild the live distance after
     * a restart; it never changes a row.
     */
    fun readByShift(shiftClientId: String, afterSeq: Long, limit: Int): List<BufferPoint> = read(
        "WHERE shift_client_id = ? AND seq > ?", listOf(shiftClientId, afterSeq), limit,
    )

    private fun read(where: String, args: List<Any?>, limit: Int): List<BufferPoint> = db.query(
        "SELECT seq, shift_client_id, recorded_at, lat_e7, lon_e7, accuracy_m, speed_dmps, bearing_deg, altitude_m " +
            "FROM telemetry_buffer $where ORDER BY seq LIMIT ${limit.coerceIn(0, 10_000)}",
        args,
    ).map { r ->
        BufferPoint(
            r[0] as Long, r[1] as String, r[2] as Long, r[3] as Long, r[4] as Long, r[5] as Long,
            r[6] as Long?, r[7] as Long?, r[8] as Long?,
        )
    }

    /** PENDING to UPLOADED with the acknowledgement time. Rows are kept for later eviction. */
    fun markUploaded(seqs: List<Long>, nowMs: Long): Int = inChunks(seqs) { marks, chunk ->
        db.update(
            "UPDATE telemetry_buffer SET sync_status = 'UPLOADED', uploaded_at = ? " +
                "WHERE sync_status = 'PENDING' AND seq IN ($marks)",
            listOf<Any?>(nowMs) + chunk,
        )
    }

    /** Moves permanently refused PENDING points to the quarantine table (08 section 4.3). */
    fun markRejected(seqs: List<Long>, reason: String, nowMs: Long): Int = db.transaction {
        inChunks(seqs) { marks, chunk ->
            db.update(
                "INSERT OR IGNORE INTO telemetry_quarantine (seq, shift_client_id, recorded_at, lat_e7, lon_e7, " +
                    "reason, quarantined_at) SELECT seq, shift_client_id, recorded_at, lat_e7, lon_e7, ?, ? " +
                    "FROM telemetry_buffer WHERE sync_status = 'PENDING' AND seq IN ($marks)",
                listOf<Any?>(reason, nowMs) + chunk,
            )
            db.update("DELETE FROM telemetry_buffer WHERE sync_status = 'PENDING' AND seq IN ($marks)", chunk)
        }
    }

    /** Deletes UPLOADED rows acknowledged before [olderThanMs]. It can never delete a PENDING row. */
    fun evictUploaded(olderThanMs: Long): Int = db.update(
        "DELETE FROM telemetry_buffer WHERE sync_status = 'UPLOADED' AND uploaded_at < ?",
        listOf(olderThanMs),
    )

    fun quarantinedCount(): Long = db.query("SELECT COUNT(*) FROM telemetry_quarantine")[0][0] as Long

    private fun inChunks(seqs: List<Long>, run: (String, List<Long>) -> Int): Int =
        seqs.chunked(400).sumOf { chunk -> run(chunk.joinToString(",") { "?" }, chunk) }
}
