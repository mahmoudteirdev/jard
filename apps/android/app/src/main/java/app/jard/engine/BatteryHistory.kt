package app.jard.engine

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.BatteryManager
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

/** A daily summary of charging events for the 7-day battery chart. */
data class DayChargeStat(
    val dateKey: String,
    val dayNameAr: String,
    val dayNameEn: String,
    val charges: Int,
    val isToday: Boolean,
)

/**
 * Tracks battery plug-in events over 7 days without running any persistent background service.
 * Events are caught via ACTION_POWER_CONNECTED and app resume checks.
 */
object BatteryHistory {
    private const val PREFS = "jard_battery_history"
    private const val KEY_DAYS = "daily_charges"
    private const val KEY_LAST_EVENT = "last_plug_ts"

    private fun getFormat() = SimpleDateFormat("yyyy-MM-dd", Locale.US)

    private fun todayKey(): String = getFormat().format(System.currentTimeMillis())

    @Synchronized
    fun recordPlug(context: Context) {
        val now = System.currentTimeMillis()
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

        // Debounce: ignore repeated broadcasts within 60 seconds
        val lastEvent = prefs.getLong(KEY_LAST_EVENT, 0L)
        if (now - lastEvent < 60_000L) return

        val today = todayKey()
        val raw = prefs.getString(KEY_DAYS, "{}") ?: "{}"
        val json = runCatching { JSONObject(raw) }.getOrDefault(JSONObject())

        val current = json.optInt(today, 0)
        json.put(today, current + 1)

        // Prune entries older than 14 days
        val cutoff = System.currentTimeMillis() - (14L * 86_400_000L)
        val cutoffKey = getFormat().format(cutoff)
        val keys = json.keys().asSequence().toList()
        for (k in keys) {
            if (k < cutoffKey) json.remove(k)
        }

        prefs.edit()
            .putString(KEY_DAYS, json.toString())
            .putLong(KEY_LAST_EVENT, now)
            .apply()
    }

    /** Called on screen visit to ensure today has at least 1 count if currently charging. */
    @Synchronized
    fun checkCurrentCharging(context: Context) {
        val bm = context.getSystemService(BatteryManager::class.java)
        val isCharging = bm?.isCharging == true
        if (isCharging) {
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val today = todayKey()
            val raw = prefs.getString(KEY_DAYS, "{}") ?: "{}"
            val json = runCatching { JSONObject(raw) }.getOrDefault(JSONObject())
            if (!json.has(today)) {
                json.put(today, 1)
                prefs.edit().putString(KEY_DAYS, json.toString()).apply()
            }
        }
    }

    /** Returns stats for the last 7 days, in chronological order ending with today. */
    fun getWeeklyStats(context: Context): List<DayChargeStat> {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY_DAYS, "{}") ?: "{}"
        val json = runCatching { JSONObject(raw) }.getOrDefault(JSONObject())

        val cal = Calendar.getInstance()
        val today = todayKey()
        val daysAr = arrayOf("الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت")
        val daysEn = arrayOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")

        val result = mutableListOf<DayChargeStat>()

        // 6 days ago up to today
        for (i in 6 downTo 0) {
            val c = Calendar.getInstance()
            c.add(Calendar.DAY_OF_YEAR, -i)
            val key = getFormat().format(c.time)
            val dayOfWeek = c.get(Calendar.DAY_OF_WEEK) - 1 // 0 = Sunday
            val nameAr = daysAr.getOrElse(dayOfWeek) { "يوم" }
            val nameEn = daysEn.getOrElse(dayOfWeek) { "Day" }
            val count = json.optInt(key, 0)

            result.add(
                DayChargeStat(
                    dateKey = key,
                    dayNameAr = nameAr,
                    dayNameEn = nameEn,
                    charges = count,
                    isToday = key == today,
                )
            )
        }

        return result
    }
}

/** BroadcastReceiver listening to system power connection events. */
class PowerConnectionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action == Intent.ACTION_POWER_CONNECTED) {
            BatteryHistory.recordPlug(context)
        }
    }
}
