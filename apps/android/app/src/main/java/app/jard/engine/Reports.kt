package app.jard.engine

import android.content.Context
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.os.Build
import android.text.Layout
import android.text.StaticLayout
import android.text.TextDirectionHeuristics
import android.text.TextPaint
import androidx.core.content.res.ResourcesCompat
import app.jard.R
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

enum class TestState { NotRun, Passed, Failed }

/** The hands-on tests, kept with when they ran. */
object ManualTests {
    val ALL = listOf("screen" to "الشاشة", "touch" to "اللمس", "speaker" to "السماعة", "mic" to "الميكروفون", "camera" to "الكاميرا", "vibrate" to "الاهتزاز")

    private fun prefs(context: Context) = context.getSharedPreferences("tests", Context.MODE_PRIVATE)

    fun state(context: Context, id: String): TestState = when (prefs(context).getString(id, null)) {
        "pass" -> TestState.Passed
        "fail" -> TestState.Failed
        else -> TestState.NotRun
    }

    fun set(context: Context, id: String, passed: Boolean) {
        prefs(context).edit().putString(id, if (passed) "pass" else "fail").apply()
    }

    fun reset(context: Context) {
        prefs(context).edit().clear().apply()
    }
}

/** The word beside each row. There's no overall score: a number out of 100 would be made up. */
enum class RowTag(val word: String) { Good("سليم"), Warn("تنبيه"), Bad("تحذير"), Neutral(""), NotChecked("غير مفحوص"), NeedsRoot("يحتاج روت") }

data class ReportRow(val key: String, val value: String, val tag: RowTag)

data class DeviceReport(val title: String, val date: Long, val rows: List<ReportRow>) {
    val warnings: Int get() = rows.count { it.tag == RowTag.Warn || it.tag == RowTag.Bad }
    val summary: String
        get() = when {
            rows.any { it.tag == RowTag.Bad } -> "فيه ملاحظات مهمة، راجعها قبل القرار."
            warnings == 1 -> "سليم، مع ملاحظة واحدة."
            warnings > 1 -> "سليم، مع $warnings ملاحظات."
            else -> "ما لقينا مشكلة في اللي انفحص."
        }
}

private fun isolate(s: String) = "\u2066$s\u2069"

object Reports {
    /** No IMEI, no photos, no accounts, no file names. What's here is safe to send to a stranger. */
    fun build(context: Context): DeviceReport {
        val b = Facts.battery(context)
        val boot = Facts.boot()
        val storage = Device.storage(context)
        fun manual(id: String, name: String) = when (ManualTests.state(context, id)) {
            TestState.Passed -> ReportRow(name, "", RowTag.Good)
            TestState.Failed -> ReportRow(name, "فشل الاختبار", RowTag.Bad)
            TestState.NotRun -> ReportRow(name, "", RowTag.NotChecked)
        }
        val rows = ArrayList<ReportRow>()
        rows.add(ReportRow("الطراز والمساحة", "${Build.MANUFACTURER} ${Build.MODEL} · ${sizeText(storage.total)}", RowTag.Neutral))
        rows.add(ReportRow("إصدار أندرويد", "Android ${Build.VERSION.RELEASE}", RowTag.Neutral))
        rows.add(ReportRow("البطارية", listOfNotNull(b.healthWord, b.cycles?.let { if (it in 3..10) "$it دورات" else "$it دورة" }).joinToString(" · "), if (b.healthy) RowTag.Good else RowTag.Warn))
        rows.add(manual("screen", "الشاشة"))
        rows.add(manual("touch", "اللمس"))
        rows.add(manual("camera", "الكاميرا"))
        rows.add(manual("speaker", "السماعة"))
        rows.add(manual("mic", "الميكروفون"))
        rows.add(manual("vibrate", "الاهتزاز"))
        rows.add(ReportRow("الحساسات", "${Facts.sensorCount(context)} موجودة", RowTag.Neutral))
        // Isolated, or the Arabic between them would flip the sizes to "GB 8.00".
        rows.add(ReportRow("المساحة", "${isolate(sizeText(storage.used))} من ${isolate(sizeText(storage.total))}", RowTag.Neutral))
        rows.add(ReportRow("الروت أو تعديل النظام", if (boot.rooted) "مكتشف" else "غير مكتشف", if (boot.rooted) RowTag.Warn else RowTag.Good))
        rows.add(
            when (boot.bootloaderLocked) {
                true -> ReportRow("Bootloader", "مقفول", RowTag.Good)
                false -> ReportRow("Bootloader", "مفتوح", RowTag.Warn)
                null -> ReportRow("Bootloader", "غير معروف", RowTag.Neutral)
            },
        )
        rows.add(ReportRow("آخر إعادة ضبط مصنع", "", RowTag.NeedsRoot))
        rows.add(ReportRow("عمر وحدة التخزين", "", RowTag.NeedsRoot))
        return DeviceReport("${Build.MANUFACTURER} ${Build.MODEL}", System.currentTimeMillis() / 1000, rows)
    }

    fun dateText(seconds: Long): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(seconds * 1000))

    /** Plain text, for sending in a chat. */
    fun text(r: DeviceReport, shop: String?, t: (String) -> String): String = buildString {
        if (!shop.isNullOrBlank()) appendLine(shop)
        appendLine("${t("تقرير حالة الهاتف")}: ${r.title} · ${dateText(r.date)}")
        appendLine(t(r.summary))
        appendLine()
        for (row in r.rows) {
            append(t(row.key)).append(": ")
            appendLine(listOf(row.value, t(row.tag.word)).filter { it.isNotEmpty() }.joinToString(" · ") { if (it == row.value) t(it) else it })
        }
        appendLine()
        appendLine(t("التقرير لا يحتوي صوراً أو حسابات أو رقم IMEI."))
        appendLine(t("الفحص لا يكشف كل الأعطال، فجرّب الهاتف بنفسك قبل الشراء."))
    }

    /** One A4 page. StaticLayout does the Arabic shaping and right-to-left order. */
    fun pdf(context: Context, r: DeviceReport, shop: String?, rtl: Boolean, t: (String) -> String): File {
        val doc = PdfDocument()
        val w = 595
        val h = 842
        val page = doc.startPage(PdfDocument.PageInfo.Builder(w, h, 1).create())
        val c = page.canvas
        val font = runCatching { ResourcesCompat.getFont(context, R.font.ibm_plex_sans_arabic_regular) }.getOrNull() ?: Typeface.DEFAULT
        val bold = runCatching { ResourcesCompat.getFont(context, R.font.ibm_plex_sans_arabic_bold) }.getOrNull() ?: Typeface.DEFAULT_BOLD
        fun paint(size: Float, tf: Typeface = font, color: Int = Color.parseColor("#141A16")) = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            textSize = size
            typeface = tf
            this.color = color
        }
        val margin = 48
        var y = 48f
        fun line(text: String, p: TextPaint, width: Int = w - margin * 2, x: Int = margin, opposite: Boolean = false): Float {
            val align = if (opposite) Layout.Alignment.ALIGN_OPPOSITE else Layout.Alignment.ALIGN_NORMAL
            val dir = if (rtl) TextDirectionHeuristics.RTL else TextDirectionHeuristics.LTR
            val l = StaticLayout.Builder.obtain(text, 0, text.length, p, width).setAlignment(align).setTextDirection(dir).build()
            c.save()
            c.translate(x.toFloat(), y)
            l.draw(c)
            c.restore()
            return l.height.toFloat()
        }
        // The logo: three bars.
        val bar = Paint()
        val barX = if (rtl) (w - margin - 40).toFloat() else margin.toFloat()
        listOf(Triple(0f, 40f, "#F5B83D"), Triple(10f, 28f, "#5B8DEF"), Triple(20f, 16f, "#E8743B")).forEach { (dy, len, col) ->
            bar.color = Color.parseColor(col)
            val x0 = if (rtl) barX + 40 - len else barX
            c.drawRect(x0, y + dy, x0 + len, y + dy + 7, bar)
        }
        y += 36
        if (!shop.isNullOrBlank()) y += line(shop, paint(16f, bold)) + 4
        y += line(t("تقرير حالة الهاتف"), paint(22f, bold)) + 2
        y += line("${r.title} · ${dateText(r.date)}", paint(12f, color = Color.parseColor("#55615A"))) + 12
        y += line(t(r.summary), paint(14f)) + 16
        val rule = Paint().apply { color = Color.parseColor("#D3D9D2") }
        for (row in r.rows) {
            val value = listOf(t(row.value), t(row.tag.word)).filter { it.isNotEmpty() }.joinToString(" · ")
            val half = (w - margin * 2) / 2
            val h1 = line(t(row.key), paint(12f), half - 8, if (rtl) margin + half else margin)
            val h2 = line(value, paint(12f, color = if (row.tag == RowTag.Warn || row.tag == RowTag.Bad) Color.parseColor("#B0431A") else Color.parseColor("#141A16")), half - 8, if (rtl) margin else margin + half)
            y += maxOf(h1, h2) + 6
            c.drawRect(margin.toFloat(), y, (w - margin).toFloat(), y + 0.6f, rule)
            y += 6
        }
        y += 12
        y += line(t("التقرير لا يحتوي صوراً أو حسابات أو رقم IMEI."), paint(11f, color = Color.parseColor("#55615A")))
        line(t("الفحص لا يكشف كل الأعطال، فجرّب الهاتف بنفسك قبل الشراء."), paint(11f, color = Color.parseColor("#55615A")))
        doc.finishPage(page)
        val dir = File(context.cacheDir, "shared").also { it.mkdirs() }
        val f = File(dir, "jard-report-${dateText(r.date)}.pdf")
        f.outputStream().use { doc.writeTo(it) }
        doc.close()
        return f
    }
}

data class ShopEntry(val id: Long, val at: Long, val name: String, val note: String, val warnings: Int, val report: DeviceReport)

/** The shop's log of phones checked on this device. Stays here unless exported. */
object ShopLog {
    private fun file(context: Context) = File(context.filesDir, "shop-log.json")

    private fun rowJson(r: ReportRow) = JSONObject().put("k", r.key).put("v", r.value).put("t", r.tag.name)

    fun add(context: Context, report: DeviceReport) {
        val first = report.rows.firstOrNull { it.tag == RowTag.Warn || it.tag == RowTag.Bad }
        val note = if (first == null) "سليم" else listOf(first.key, first.value).filter { it.isNotEmpty() }.joinToString(": ")
        val rows = JSONArray().also { a -> report.rows.forEach { a.put(rowJson(it)) } }
        val entry = JSONObject().put("id", System.nanoTime()).put("at", report.date).put("name", report.title).put("note", note)
            .put("warnings", report.warnings).put("rows", rows)
        val list = raw(context)
        list.put(entry)
        file(context).writeText(list.toString())
    }

    private fun raw(context: Context): JSONArray = runCatching { JSONArray(file(context).readText()) }.getOrDefault(JSONArray())

    fun list(context: Context): List<ShopEntry> {
        val a = raw(context)
        return (a.length() - 1 downTo 0).map { i ->
            val o = a.getJSONObject(i)
            val rows = o.getJSONArray("rows")
            val parsed = (0 until rows.length()).map { j ->
                rows.getJSONObject(j).let { ReportRow(it.getString("k"), it.getString("v"), RowTag.valueOf(it.getString("t"))) }
            }
            ShopEntry(o.getLong("id"), o.getLong("at"), o.getString("name"), o.getString("note"), o.getInt("warnings"), DeviceReport(o.getString("name"), o.getLong("at"), parsed))
        }
    }

    /** A spreadsheet treats a cell starting with these as a formula, and a device name is free text. */
    internal fun csvCell(s: String): String {
        val safe = if (s.isNotEmpty() && s[0] in "=+-@\t\r") "'$s" else s
        return "\"" + safe.replace("\"", "\"\"") + "\""
    }

    fun exportCsv(context: Context, t: (String) -> String): File {
        val dir = File(context.cacheDir, "shared").also { it.mkdirs() }
        val f = File(dir, "jard-shop-log.csv")
        f.writeText(buildString {
            append('﻿') // so Excel reads it as UTF-8
            appendLine(listOf("date", "device", "warnings", "note").joinToString(","))
            for (e in list(context)) appendLine(listOf(Reports.dateText(e.at), csvCell(e.name), e.warnings.toString(), csvCell(t(e.note))).joinToString(","))
        })
        return f
    }

    fun clear(context: Context) {
        file(context).delete()
    }
}
