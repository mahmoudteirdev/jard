package app.jard.engine

import android.app.ActivityManager
import android.app.usage.NetworkStats
import android.app.usage.NetworkStatsManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.Sensor
import android.hardware.SensorManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.net.ConnectivityManager
import android.opengl.EGL14
import android.opengl.GLES20
import android.os.BatteryManager
import android.os.Build
import android.os.StatFs
import android.view.WindowManager
import java.io.File
import java.io.RandomAccessFile
import java.util.Calendar

/** Android's own system properties. Read-only, and some are absent on some phones. */
fun getprop(name: String): String = runCatching {
    Class.forName("android.os.SystemProperties").getMethod("get", String::class.java).invoke(null, name) as String
}.getOrDefault("")

data class Fact(val key: String, val value: String)

data class BatteryFacts(
    val percent: Int,
    val charging: Boolean,
    val tempC: Float,
    val volts: Float,
    val healthWord: String,
    val healthy: Boolean,
    val technology: String,
    /** Android 14 and newer report this. Null elsewhere: we say so rather than guess. */
    val cycles: Int?,
    /** What's left right now, in mAh, when the phone reports it. */
    val chargeNowMah: Int?,
    /** From the phone's power profile, when it has one. */
    val designMah: Int?,
)

data class BootFacts(val rooted: Boolean, val bootloaderLocked: Boolean?, val verifiedBoot: String, val selinux: String)

data class BenchResult(val readMbS: Double, val writeMbS: Double, val memoryGbS: Double)

object Facts {
    fun battery(context: Context): BatteryFacts {
        val i = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = i?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = i?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100
        val status = i?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        val health = i?.getIntExtra(BatteryManager.EXTRA_HEALTH, 0) ?: 0
        val word = when (health) {
            BatteryManager.BATTERY_HEALTH_GOOD -> "جيدة"
            BatteryManager.BATTERY_HEALTH_OVERHEAT -> "سخونة زائدة"
            BatteryManager.BATTERY_HEALTH_DEAD -> "تالفة"
            BatteryManager.BATTERY_HEALTH_COLD -> "باردة جداً"
            BatteryManager.BATTERY_HEALTH_OVER_VOLTAGE -> "جهد زائد"
            else -> "غير معروفة"
        }
        val cycles = if (Build.VERSION.SDK_INT >= 34) i?.getIntExtra(BatteryManager.EXTRA_CYCLE_COUNT, -1)?.takeIf { it >= 0 } else null
        val bm = context.getSystemService(BatteryManager::class.java)
        val counter = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CHARGE_COUNTER)
        return BatteryFacts(
            percent = if (level >= 0) level * 100 / scale else -1,
            charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL,
            tempC = (i?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) ?: 0) / 10f,
            volts = (i?.getIntExtra(BatteryManager.EXTRA_VOLTAGE, 0) ?: 0) / 1000f,
            healthWord = word,
            healthy = health == BatteryManager.BATTERY_HEALTH_GOOD,
            technology = i?.getStringExtra(BatteryManager.EXTRA_TECHNOLOGY).orEmpty(),
            cycles = cycles,
            chargeNowMah = if (counter > 0 && counter != Int.MAX_VALUE) counter / 1000 else null,
            designMah = designCapacity(context),
        )
    }

    private fun designCapacity(context: Context): Int? = runCatching {
        val cls = Class.forName("com.android.internal.os.PowerProfile")
        val profile = cls.getConstructor(Context::class.java).newInstance(context)
        (cls.getMethod("getBatteryCapacity").invoke(profile) as Double).toInt().takeIf { it > 0 }
    }.getOrNull()

    fun boot(): BootFacts {
        val suPaths = listOf("/system/bin/su", "/system/xbin/su", "/sbin/su", "/su/bin/su", "/data/adb/magisk", "/system/app/Superuser.apk")
        val rooted = suPaths.any { File(it).exists() } || Build.TAGS?.contains("test-keys") == true
        val flash = getprop("ro.boot.flash.locked")
        val locked = when {
            flash == "1" -> true
            flash == "0" -> false
            getprop("ro.boot.vbmeta.device_state") == "locked" -> true
            getprop("ro.boot.vbmeta.device_state") == "unlocked" -> false
            else -> null
        }
        return BootFacts(rooted, locked, getprop("ro.boot.verifiedbootstate"), getprop("ro.boot.selinux"))
    }

    fun sensorCount(context: Context): Int = context.getSystemService(SensorManager::class.java).getSensorList(Sensor.TYPE_ALL).size

    /** The main sensors, by the word for each: present or not. */
    fun cameras(context: Context): List<String> = runCatching {
        val cm = context.getSystemService(CameraManager::class.java)
        cm.cameraIdList.mapNotNull { id ->
            val size = cm.getCameraCharacteristics(id).get(CameraCharacteristics.SENSOR_INFO_PIXEL_ARRAY_SIZE) ?: return@mapNotNull null
            "%d MP".format(((size.width * size.height) / 1_000_000.0).let { kotlin.math.round(it).toInt() })
        }
    }.getOrDefault(emptyList())

    /** The graphics chip's name needs a live GL context, so one is made and closed here. */
    fun gpu(): String = runCatching {
        val display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
        EGL14.eglInitialize(display, IntArray(2), 0, IntArray(2), 1)
        val configs = arrayOfNulls<android.opengl.EGLConfig>(1)
        val attrs = intArrayOf(EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT, EGL14.EGL_NONE)
        EGL14.eglChooseConfig(display, attrs, 0, configs, 0, 1, IntArray(1), 0)
        val ctx = EGL14.eglCreateContext(display, configs[0], EGL14.EGL_NO_CONTEXT, intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE), 0)
        val surface = EGL14.eglCreatePbufferSurface(display, configs[0], intArrayOf(EGL14.EGL_WIDTH, 1, EGL14.EGL_HEIGHT, 1, EGL14.EGL_NONE), 0)
        EGL14.eglMakeCurrent(display, surface, surface, ctx)
        val name = GLES20.glGetString(GLES20.GL_RENDERER).orEmpty()
        EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
        EGL14.eglDestroySurface(display, surface)
        EGL14.eglDestroyContext(display, ctx)
        EGL14.eglTerminate(display)
        name
    }.getOrDefault("")

    fun hardware(context: Context): List<Fact> {
        val am = context.getSystemService(ActivityManager::class.java)
        val mem = ActivityManager.MemoryInfo().also { am.getMemoryInfo(it) }
        val soc = if (Build.VERSION.SDK_INT >= 31) "${Build.SOC_MANUFACTURER} ${Build.SOC_MODEL}".trim() else Build.HARDWARE
        @Suppress("DEPRECATION")
        val display = context.getSystemService(WindowManager::class.java).defaultDisplay
        val mode = display.mode
        return listOf(
            Fact("المعالج", soc),
            Fact("الأنوية", Runtime.getRuntime().availableProcessors().toString()),
            Fact("كرت الشاشة", gpu().ifEmpty { "—" }),
            Fact("الذاكرة", sizeText(mem.totalMem)),
            Fact("التخزين", sizeText(Device.storage(context).total)),
            Fact("الشاشة", "${mode.physicalWidth}×${mode.physicalHeight} · ${mode.refreshRate.toInt()} Hz"),
            Fact("الكاميرات", cameras(context).joinToString(" / ").ifEmpty { "—" }),
            Fact("الحساسات", sensorCount(context).toString()),
        )
    }

    fun system(): List<Fact> {
        val ab = getprop("ro.build.ab_update") == "true"
        val treble = getprop("ro.treble.enabled") == "true"
        return listOf(
            Fact("إصدار أندرويد", "Android ${Build.VERSION.RELEASE}"),
            Fact("تحديث الأمان", Build.VERSION.SECURITY_PATCH),
            Fact("النواة", System.getProperty("os.version").orEmpty()),
            Fact("Project Treble", if (treble) "مدعوم" else "غير مدعوم"),
            Fact("التحديثات (A/B)", if (ab) "Seamless" else "عادية"),
            Fact("البناء", Build.DISPLAY),
        )
    }

    /** Reads and writes a temporary file, then deletes it. A rough figure: phones cache aggressively. */
    fun bench(context: Context): BenchResult {
        val size = 64 * 1024 * 1024
        val block = ByteArray(1024 * 1024) { (it * 31).toByte() }
        val f = File(context.cacheDir, "speedtest.tmp")
        try {
            val w0 = System.nanoTime()
            RandomAccessFile(f, "rw").use { r ->
                repeat(size / block.size) { r.write(block) }
                r.fd.sync()
            }
            val writeS = (System.nanoTime() - w0) / 1e9
            val r0 = System.nanoTime()
            RandomAccessFile(f, "r").use { r -> while (r.read(block) > 0) Unit }
            val readS = (System.nanoTime() - r0) / 1e9
            val mem = ByteArray(32 * 1024 * 1024)
            val other = ByteArray(mem.size)
            val m0 = System.nanoTime()
            repeat(8) { System.arraycopy(mem, 0, other, 0, mem.size) }
            val memS = (System.nanoTime() - m0) / 1e9
            return BenchResult(size / 1e6 / readS, size / 1e6 / writeS, 8 * mem.size / 1e9 / memS)
        } finally {
            f.delete()
        }
    }

    fun storageUsedPercent(context: Context): Int {
        val s = StatFs(android.os.Environment.getDataDirectory().path)
        return if (s.totalBytes > 0) (100 - s.availableBytes * 100 / s.totalBytes).toInt() else 0
    }
}

data class AppUse(val name: String, val pkg: String, val wifi: Long, val mobile: Long) {
    val total: Long get() = wifi + mobile
}

object NetworkUse {
    /** This month's data per app, from the system's own counters. Needs usage access, and no internet. */
    fun thisMonth(context: Context): List<AppUse> {
        val nsm = context.getSystemService(NetworkStatsManager::class.java)
        val start = Calendar.getInstance().apply {
            set(Calendar.DAY_OF_MONTH, 1); set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0)
        }.timeInMillis
        val end = System.currentTimeMillis()
        fun sum(type: Int): Map<Int, Long> {
            val out = HashMap<Int, Long>()
            runCatching {
                nsm.querySummary(type, null, start, end).use { stats ->
                    val b = NetworkStats.Bucket()
                    while (stats.hasNextBucket()) {
                        stats.getNextBucket(b)
                        out.merge(b.uid, b.rxBytes + b.txBytes, Long::plus)
                    }
                }
            }
            return out
        }
        val wifi = sum(ConnectivityManager.TYPE_WIFI)
        val mobile = sum(ConnectivityManager.TYPE_MOBILE)
        val pm = context.packageManager
        return (wifi.keys + mobile.keys).mapNotNull { uid ->
            val pkg = pm.getPackagesForUid(uid)?.firstOrNull() ?: return@mapNotNull null
            val name = runCatching { pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString() }.getOrDefault(pkg)
            AppUse(name, pkg, wifi[uid] ?: 0, mobile[uid] ?: 0)
        }.filter { it.total > 0 }.sortedByDescending { it.total }
    }
}

/** How recently apps ran, for "why is it slow". */
object AppRecency {
    fun activeLastDay(context: Context): Int {
        val um = context.getSystemService(UsageStatsManager::class.java)
        val now = System.currentTimeMillis()
        return runCatching {
            um.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, now - 86_400_000, now).count { it.totalTimeInForeground > 0 }
        }.getOrDefault(0)
    }
}
