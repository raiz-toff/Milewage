package app.milewage.phone.platform

import android.content.Context
import android.os.BatteryManager
import app.milewage.core.shift.BatteryPort
import app.milewage.core.shift.BatteryReading
import app.milewage.core.shift.Recorder
import app.milewage.core.tracking.Interruption
import app.milewage.core.tracking.TrackingMode
import app.milewage.tracking.TrackingController

/** The shift model's [Recorder] on the tracking module's controller (`:data` cannot depend on `:tracking`). */
class TrackingRecorder(private val controller: () -> TrackingController) : Recorder {
    private val c: TrackingController get() = controller()

    override suspend fun start(shiftClientId: String, startedAt: Long): Boolean =
        c.startShift(shiftClientId, startedAt) == TrackingController.StartResult.STARTED

    override suspend fun stop() = c.stopShift()

    override suspend fun recording(): String? = c.status.value.takeIf { it.mode == TrackingMode.RECORDING }?.shiftClientId

    override suspend fun interruptions(shiftClientId: String): List<Interruption> = c.interruptions(shiftClientId)

    override fun gnssOffsetMs(): Long? = c.gnssOffsetMs()
}

/** The battery at shift start and end (`shift.summary` diagnostics), from BatteryManager; null when it cannot say. */
class AndroidBattery(context: Context) : BatteryPort {
    private val app = context.applicationContext

    override suspend fun read(): BatteryReading? {
        val bm = app.getSystemService(BatteryManager::class.java) ?: return null
        val level = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        if (level !in 0..100) return null
        return BatteryReading(level, bm.isCharging)
    }
}
