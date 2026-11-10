package app.jard.engine

import android.content.Context
import android.os.Environment
import android.os.StatFs
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.abs

enum class AndroidDepletionStatus {
    Stable,
    GradualBurn,
    CriticalBurn,
    FreeingSpace,
}

data class AndroidStorageSnapshot(
    val timestampMs: Long,
    val freeBytes: Long,
    val totalBytes: Long,
)

data class AndroidDepletionForecast(
    val currentFreeBytes: Long,
    val currentTotalBytes: Long,
    val dailyBurnBytes: Long,
    val estimatedDaysRemaining: Int?,
    val exhaustionDateIso: String?,
    val status: AndroidDepletionStatus,
    val recommendationAr: String,
    val recommendationEn: String,
    val confidenceScore: Float,
    val burnVelocityMbPerDay: Double,
)

object PredictiveStorage {

    fun predict(context: Context): AndroidDepletionForecast {
        val stat = StatFs(Environment.getDataDirectory().path)
        val free = stat.availableBytes
        val total = stat.totalBytes
        val nowMs = System.currentTimeMillis()

        val historyFile = File(context.filesDir, "storage_history.json")
        val snapshots = loadSnapshots(historyFile)

        // Append current snapshot if more than 30 minutes since last recording
        val last = snapshots.lastOrNull()
        if (last == null || nowMs - last.timestampMs >= 1800_000L) {
            snapshots.add(AndroidStorageSnapshot(nowMs, free, total))
            if (snapshots.size > 120) {
                snapshots.removeAt(0)
            }
            saveSnapshots(historyFile, snapshots)
        }

        val freeRatio = if (total > 0) free.toDouble() / total.toDouble() else 1.0

        if (snapshots.size < 2) {
            val (status, recAr, recEn, days) = when {
                freeRatio < 0.05 -> {
                    Quadruple(
                        AndroidDepletionStatus.CriticalBurn,
                        "المساحة الحرة أقل من 5%! يُنصح بتنظيف الملفات فوراً لتجنب بطء الهاتف.",
                        "Free space is under 5%! Immediate cleanup recommended to avoid phone slowdown.",
                        3
                    )
                }
                freeRatio < 0.15 -> {
                    Quadruple(
                        AndroidDepletionStatus.GradualBurn,
                        "المساحة الحرة تقترب من الحد الأدنى (أقل من 15%). يُفضل حذف التطبيقات والمثبتات القديمة.",
                        "Free space is low (under 15%). Consider removing stale APKs and media.",
                        40
                    )
                }
                else -> {
                    Quadruple(
                        AndroidDepletionStatus.Stable,
                        "المساحة الحرة وفيرة ومستقرة. يجري جمع بيانات الفحص اليومية لتوليد توقعات دقيقة.",
                        "Storage is healthy and stable. Collecting historical snapshots for precise trend forecasting.",
                        null
                    )
                }
            }

            val exhaustionDate = days?.let { d -> formatDate(nowMs + d * 86_400_000L) }

            return AndroidDepletionForecast(
                currentFreeBytes = free,
                currentTotalBytes = total,
                dailyBurnBytes = 0L,
                estimatedDaysRemaining = days,
                exhaustionDateIso = exhaustionDate,
                status = status,
                recommendationAr = recAr,
                recommendationEn = recEn,
                confidenceScore = 0.35f,
                burnVelocityMbPerDay = 0.0,
            )
        }

        // Regression across snapshots
        val first = snapshots.first()
        val latest = snapshots.last()
        val spanDays = (latest.timestampMs - first.timestampMs).toDouble() / 86_400_000.0

        val validDeltas = mutableListOf<Double>()
        for (i in 0 until snapshots.size - 1) {
            val a = snapshots[i]
            val b = snapshots[i + 1]
            val dt = (b.timestampMs - a.timestampMs).toDouble() / 86_400_000.0
            if (dt > 0.01) {
                val df = (a.freeBytes - b.freeBytes).toDouble()
                val rate = df / dt
                if (abs(df) < total * 0.30) { // filter extreme single-day jump > 30%
                    validDeltas.add(rate)
                }
            }
        }

        val dailyBurn = if (validDeltas.isNotEmpty()) {
            validDeltas.sum() / validDeltas.size.toDouble()
        } else {
            (first.freeBytes - latest.freeBytes).toDouble() / spanDays.coerceAtLeast(0.1)
        }

        val velocityMb = dailyBurn / (1024.0 * 1024.0)
        val reserveBuffer = (total * 0.05).toLong() // 5% emergency Android system buffer
        val usableFree = (free - reserveBuffer).coerceAtLeast(0L)

        val thresholdBurnMb = 40.0 // 40 MB / day baseline threshold

        val (status, days, recAr, recEn) = when {
            dailyBurn < -thresholdBurnMb * 1024.0 * 1024.0 -> {
                Quadruple(
                    AndroidDepletionStatus.FreeingSpace,
                    null,
                    String.format(Locale.ROOT, "مساحتك الحرة تتزايد بمعدل (+%.1f MB يومياً) نتيجة حذف وتنظيف الملفات.", abs(velocityMb)),
                    String.format(Locale.ROOT, "Free space is expanding by (+%.1f MB/day) from recent cleanup.", abs(velocityMb))
                )
            }
            dailyBurn < thresholdBurnMb * 1024.0 * 1024.0 -> {
                Quadruple(
                    AndroidDepletionStatus.Stable,
                    null,
                    "استهلاك المساحة مستقر ومنتظم، لا يوجد خطر نفاد في المدى القريب.",
                    "Storage consumption is stable. No exhaustion risk in the near future."
                )
            }
            else -> {
                val d = (usableFree.toDouble() / dailyBurn).coerceAtLeast(1.0).toInt()
                val dateStr = formatDate(nowMs + d.toLong() * 86_400_000L)
                if (d <= 21 || freeRatio < 0.10) {
                    Quadruple(
                        AndroidDepletionStatus.CriticalBurn,
                        d,
                        String.format(Locale.ROOT, "⚠️ وتيرة استهلاك سريعة: الذاكرة تتقلص بمعدل (+%.1f MB يومياً). التقدير: ستنفد خلال %d يوماً (بتاريخ %s).", velocityMb, d, dateStr),
                        String.format(Locale.ROOT, "⚠️ High burn rate: space shrinking by (+%.1f MB/day). Estimated exhaustion in %d days (by %s).", velocityMb, d, dateStr)
                    )
                } else {
                    Quadruple(
                        AndroidDepletionStatus.GradualBurn,
                        d,
                        String.format(Locale.ROOT, "معدل استهلاك تدريجي (+%.1f MB يومياً). المساحة تكفي لنحو %d يوماً (حتى %s).", velocityMb, d, dateStr),
                        String.format(Locale.ROOT, "Gradual burn rate (+%.1f MB/day). Space is projected to last ~%d days (until %s).", velocityMb, d, dateStr)
                    )
                }
            }
        }

        val confidence = ((snapshots.size * 0.15f) + (spanDays.toFloat() * 0.05f)).coerceIn(0.40f, 0.95f)
        val exhaustionDateIso = days?.let { d -> formatDate(nowMs + d * 86_400_000L) }

        return AndroidDepletionForecast(
            currentFreeBytes = free,
            currentTotalBytes = total,
            dailyBurnBytes = dailyBurn.toLong(),
            estimatedDaysRemaining = days,
            exhaustionDateIso = exhaustionDateIso,
            status = status,
            recommendationAr = recAr,
            recommendationEn = recEn,
            confidenceScore = confidence,
            burnVelocityMbPerDay = velocityMb,
        )
    }

    private fun formatDate(ms: Long): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd", Locale.US)
        return sdf.format(Date(ms))
    }

    private fun loadSnapshots(file: File): MutableList<AndroidStorageSnapshot> {
        val list = mutableListOf<AndroidStorageSnapshot>()
        if (!file.exists()) return list
        try {
            val jsonStr = file.readText()
            val array = JSONArray(jsonStr)
            for (i in 0 until array.length()) {
                val obj = array.getJSONObject(i)
                list.add(
                    AndroidStorageSnapshot(
                        timestampMs = obj.getLong("timestamp"),
                        freeBytes = obj.getLong("freeBytes"),
                        totalBytes = obj.getLong("totalBytes"),
                    )
                )
            }
        } catch (_: Exception) {}
        return list
    }

    private fun saveSnapshots(file: File, snapshots: List<AndroidStorageSnapshot>) {
        try {
            val array = JSONArray()
            for (s in snapshots) {
                val obj = JSONObject()
                obj.put("timestamp", s.timestampMs)
                obj.put("freeBytes", s.freeBytes)
                obj.put("totalBytes", s.totalBytes)
                array.put(obj)
            }
            file.writeText(array.toString(2))
        } catch (_: Exception) {}
    }
}

private data class Quadruple<A, B, C, D>(val first: A, val second: B, val third: C, val fourth: D)
