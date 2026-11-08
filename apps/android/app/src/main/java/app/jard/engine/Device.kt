package app.jard.engine

import android.app.ActivityManager
import android.app.AppOpsManager
import android.app.usage.StorageStatsManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.Process
import android.os.StatFs
import android.os.storage.StorageManager
import android.provider.Settings
import java.util.Locale

data class StorageTotals(val total: Long, val free: Long) {
    val used: Long get() = total - free
}

data class AppSize(val pkg: String, val name: String, val app: Long, val data: Long, val cache: Long, val system: Boolean) {
    val total: Long get() = app + data + cache
}

data class DeviceInfo(
    val model: String,
    val android: String,
    val securityPatch: String,
    val cpu: String,
    val ramTotal: Long,
    val ramFree: Long,
    val batteryPercent: Int,
    val batteryCharging: Boolean,
    val batteryTemp: Float,
    val batteryHealth: String,
    val screenLock: Boolean,
    val devOptions: Boolean,
)

object Device {
    fun storage(context: Context): StorageTotals {
        val ssm = context.getSystemService(StorageStatsManager::class.java)
        return try {
            StorageTotals(ssm.getTotalBytes(StorageManager.UUID_DEFAULT), ssm.getFreeBytes(StorageManager.UUID_DEFAULT))
        } catch (_: Exception) {
            val s = StatFs(Environment.getDataDirectory().path)
            StorageTotals(s.totalBytes, s.availableBytes)
        }
    }

    /** May this app read all of shared storage? Android 11 made this its own permission. */
    fun hasAllFiles(context: Context): Boolean =
        if (Build.VERSION.SDK_INT >= 30) {
            Environment.isExternalStorageManager()
        } else {
            LEGACY_STORAGE.all { context.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }
        }

    val LEGACY_STORAGE = arrayOf(android.Manifest.permission.READ_EXTERNAL_STORAGE, android.Manifest.permission.WRITE_EXTERNAL_STORAGE)

    fun hasUsageAccess(context: Context): Boolean {
        val ops = context.getSystemService(AppOpsManager::class.java)
        val mode = if (Build.VERSION.SDK_INT >= 29) {
            ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
        } else {
            @Suppress("DEPRECATION")
            ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
        }
        return mode == AppOpsManager.MODE_ALLOWED
    }

    /** Sizes from the system. Needs the usage-access permission, which the person grants in settings. */
    fun apps(context: Context): List<AppSize> {
        val pm = context.packageManager
        val ssm = context.getSystemService(StorageStatsManager::class.java)
        val user = Process.myUserHandle()
        return pm.getInstalledApplications(0).mapNotNull { a ->
            runCatching {
                val s = ssm.queryStatsForPackage(StorageManager.UUID_DEFAULT, a.packageName, user)
                AppSize(
                    a.packageName, pm.getApplicationLabel(a).toString(), s.appBytes, s.dataBytes - s.cacheBytes, s.cacheBytes,
                    a.flags and ApplicationInfo.FLAG_SYSTEM != 0,
                )
            }.getOrNull()
        }.sortedByDescending { it.total }
    }

    fun info(context: Context): DeviceInfo {
        val am = context.getSystemService(ActivityManager::class.java)
        val mem = ActivityManager.MemoryInfo().also { am.getMemoryInfo(it) }
        val battery = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = battery?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100
        val status = battery?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        val temp = (battery?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) ?: 0) / 10f
        val health = when (battery?.getIntExtra(BatteryManager.EXTRA_HEALTH, 0)) {
            BatteryManager.BATTERY_HEALTH_GOOD -> "جيدة"
            BatteryManager.BATTERY_HEALTH_OVERHEAT -> "سخونة زائدة"
            BatteryManager.BATTERY_HEALTH_DEAD -> "تالفة"
            BatteryManager.BATTERY_HEALTH_COLD -> "باردة جداً"
            else -> "غير معروفة"
        }
        val km = context.getSystemService(android.app.KeyguardManager::class.java)
        return DeviceInfo(
            model = "${Build.MANUFACTURER} ${Build.MODEL}".replaceFirstChar { it.titlecase(Locale.US) },
            android = Build.VERSION.RELEASE,
            securityPatch = Build.VERSION.SECURITY_PATCH,
            cpu = Build.SUPPORTED_ABIS.firstOrNull().orEmpty(),
            ramTotal = mem.totalMem,
            ramFree = mem.availMem,
            batteryPercent = if (level >= 0) level * 100 / scale else -1,
            batteryCharging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL,
            batteryTemp = temp,
            batteryHealth = health,
            screenLock = km.isDeviceSecure,
            devOptions = Settings.Global.getInt(context.contentResolver, Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0) == 1,
        )
    }
}

private val UNITS = arrayOf("B", "KB", "MB", "GB", "TB")

/** 1234567 -> "1.23 MB". Western digits and the unit, always. */
fun sizeText(bytes: Long): String {
    var v = bytes.toDouble()
    var i = 0
    while (v >= 1000 && i < UNITS.lastIndex) {
        v /= 1000
        i++
    }
    if (i == 0) return "$bytes B"
    val digits = if (v >= 100) 0 else if (v >= 10) 1 else 2
    return String.format(Locale.US, "%.${digits}f %s", v, UNITS[i])
}

fun countText(n: Long): String = String.format(Locale.US, "%,d", n)

/** "قبل 3 أشهر" with Western digits. */
fun agoText(seconds: Long, now: Long = System.currentTimeMillis() / 1000): String {
    if (seconds <= 0) return "—"
    val d = (now - seconds) / 86_400
    return when {
        d < 1 -> "اليوم"
        d < 30 -> "قبل $d يوم"
        d < 365 -> "قبل ${d / 30} شهر"
        else -> "قبل ${d / 365} سنة"
    }
}
