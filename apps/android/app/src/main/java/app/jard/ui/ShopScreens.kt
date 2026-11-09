package app.jard.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.ToneGenerator
import android.os.VibrationEffect
import android.os.Vibrator
import android.provider.MediaStore
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import app.jard.design.Jard
import app.jard.design.JardType
import app.jard.engine.DeviceReport
import app.jard.engine.ManualTests
import app.jard.engine.ReportRow
import app.jard.engine.Reports
import app.jard.engine.RowTag
import app.jard.engine.ShopEntry
import app.jard.engine.ShopLog
import app.jard.engine.TestState
import kotlin.concurrent.thread

@Composable
fun ManualTestsList(s: AppState) {
    val context = LocalContext.current
    val states = remember(s.version, s.page) { ManualTests.ALL.map { (id, name) -> Triple(id, name, ManualTests.state(context, id)) } }
    val done = states.count { it.third != TestState.NotRun }
    Row(verticalAlignment = Alignment.CenterVertically) {
        T("اختبارات يدوية", Modifier.weight(1f), weight = FontWeight.Bold)
        Num("$done / ${states.size}")
    }
    for ((id, name, state) in states) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 48.dp).background(Jard.colors.surfaceRaised)
                .border(BorderStroke(1.dp, if (state == TestState.Failed) Jard.colors.statusSerious else Jard.colors.line))
                .clickable(role = Role.Button) { s.testing = id; s.page = Page.Test }
                .padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            T(name, Modifier.weight(1f), weight = FontWeight.SemiBold)
            when (state) {
                TestState.Passed -> T("سليم", color = Jard.colors.statusGood)
                TestState.Failed -> T("فشل", color = Jard.colors.statusSerious)
                TestState.NotRun -> T("ابدأ الاختبار", color = Jard.colors.inkMuted)
            }
        }
    }
}

/** Every test ends the same way: the person says whether it worked. We can't see the screen or hear the speaker. */
@Composable
private fun Answer(s: AppState, question: String, id: String) {
    val context = LocalContext.current
    T(question, style = JardType.title)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Btn("نعم، شغال", { ManualTests.set(context, id, true); s.goBack() }, Modifier.weight(1f), BtnKind.Primary, minHeight = 52.dp)
        Btn("لا", { ManualTests.set(context, id, false); s.goBack() }, Modifier.weight(1f), minHeight = 52.dp)
    }
    Btn("رجوع بدون نتيجة", { s.goBack() }, Modifier.fillMaxWidth())
}

@Composable
fun ManualTestScreen(s: AppState) {
    when (s.testing) {
        "screen" -> ScreenTest(s)
        "touch" -> TouchTest(s)
        "speaker" -> SpeakerTest(s)
        "mic" -> MicTest(s)
        "camera" -> CameraTest(s)
        else -> VibrateTest(s)
    }
}

@Composable
private fun ScreenTest(s: AppState) {
    val colors = listOf(Color.White, Color.Black, Color.Red, Color.Green, Color.Blue)
    var i by remember { mutableStateOf(0) }
    if (i < colors.size) {
        Box(
            Modifier.fillMaxSize().background(colors[i]).clickable(role = Role.Button, onClickLabel = I18n.tr("اللون التالي")) { i++ },
        )
    } else {
        Page {
            Muted("عرضنا خمسة ألوان على كامل الشاشة.")
            Answer(s, "كانت الألوان سليمة، بدون نقاط أو خطوط أو بقع؟", "screen")
        }
    }
}

private const val COLS = 7
private const val ROWS = 12

/** Drag across every cell. A dead area shows as cells that won't turn on. */
@Composable
private fun TouchTest(s: AppState) {
    val context = LocalContext.current
    val cells = remember { mutableStateListOf<Boolean>().apply { repeat(COLS * ROWS) { add(false) } } }
    var size by remember { mutableStateOf(IntSize.Zero) }
    val done = cells.count { it }
    fun touch(x: Float, y: Float) {
        if (size.width == 0 || size.height == 0) return
        val c = (x * COLS / size.width).toInt().coerceIn(0, COLS - 1)
        val r = (y * ROWS / size.height).toInt().coerceIn(0, ROWS - 1)
        cells[r * COLS + c] = true
        if (cells.all { it }) {
            ManualTests.set(context, "touch", true)
            s.goBack()
        }
    }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            T("اسحب إصبعك على كل المربعات", Modifier.weight(1f))
            Num("$done / ${cells.size}")
            Btn("فيه منطقة ما بتستجيب", { ManualTests.set(context, "touch", false); s.goBack() })
        }
        Column(
            Modifier.weight(1f).fillMaxWidth().onSizeChanged { size = it }.pointerInput(Unit) {
                awaitEachGesture {
                    val down = awaitFirstDown()
                    touch(down.position.x, down.position.y)
                    while (true) {
                        val e = awaitPointerEvent()
                        val p = e.changes.firstOrNull() ?: break
                        if (!p.pressed) break
                        touch(p.position.x, p.position.y)
                        p.consume()
                    }
                }
            }.semantics { contentDescription = I18n.tr("مربعات اختبار اللمس") },
        ) {
            for (r in 0 until ROWS) {
                Row(Modifier.weight(1f).fillMaxWidth()) {
                    for (c in 0 until COLS) {
                        Box(Modifier.weight(1f).fillMaxSize().background(if (cells[r * COLS + c]) Jard.colors.accent else Jard.colors.surfaceRaised).border(BorderStroke(1.dp, Jard.colors.line)))
                    }
                }
            }
        }
    }
}

@Composable
private fun SpeakerTest(s: AppState) {
    var played by remember { mutableStateOf(false) }
    Page {
        T("اختبار السماعة", style = JardType.title)
        Muted("ارفع الصوت أولاً.")
        Btn(if (played) "شغّل مرة ثانية" else "شغّل الصوت", {
            played = true
            thread {
                runCatching {
                    val tone = ToneGenerator(AudioManager.STREAM_MUSIC, 100)
                    tone.startTone(ToneGenerator.TONE_DTMF_5, 1500)
                    Thread.sleep(1600)
                    tone.release()
                }
            }
        }, Modifier.fillMaxWidth(), BtnKind.Primary, minHeight = 52.dp)
        if (played) Answer(s, "سمعت الصوت بوضوح؟", "speaker") else Btn("رجوع", { s.goBack() }, Modifier.fillMaxWidth())
    }
}

/** Listens for two seconds and looks only at how loud it was. Nothing is stored or played back. */
@Composable
private fun MicTest(s: AppState) {
    val context = LocalContext.current
    var peak by remember { mutableStateOf<Int?>(null) }
    var busy by remember { mutableStateOf(false) }
    var refused by remember { mutableStateOf(false) }
    fun listen() {
        busy = true
        thread {
            peak = runCatching { loudest() }.getOrDefault(0)
            busy = false
        }
    }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok -> if (ok) listen() else refused = true }
    Page {
        T("اختبار الميكروفون", style = JardType.title)
        T("اضغط واحكِ بصوت عادي لثانيتين. نقيس قوة الصوت فقط، وما منسجل ولا منحفظ شي.", color = Jard.colors.inkQuiet)
        if (refused) Note("بدون إذن الميكروفون ما بنقدر نختبره.", Jard.colors.statusWarn)
        Btn(if (busy) "يستمع…" else "ابدأ", {
            if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) listen()
            else ask.launch(Manifest.permission.RECORD_AUDIO)
        }, Modifier.fillMaxWidth(), BtnKind.Primary, enabled = !busy, minHeight = 52.dp)
        val p = peak
        if (p != null) {
            val heard = p > 1500
            T(if (heard) "التقط الميكروفون صوتاً." else "ما التقط الميكروفون صوتاً واضحاً.", color = if (heard) Jard.colors.statusGood else Jard.colors.statusWarn)
            Btn(if (heard) "اعتمد: شغال" else "اعتمد: ما اشتغل", { ManualTests.set(context, "mic", heard); s.goBack() }, Modifier.fillMaxWidth())
        }
        Btn("رجوع", { s.goBack() }, Modifier.fillMaxWidth())
    }
}

@android.annotation.SuppressLint("MissingPermission") // asked for just before this runs
private fun loudest(): Int {
    val rate = 16_000
    val min = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    val rec = AudioRecord(MediaRecorder.AudioSource.MIC, rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, min * 2)
    val buf = ShortArray(min)
    var peak = 0
    try {
        rec.startRecording()
        val end = System.currentTimeMillis() + 2000
        while (System.currentTimeMillis() < end) {
            val n = rec.read(buf, 0, buf.size)
            for (i in 0 until n) peak = maxOf(peak, kotlin.math.abs(buf[i].toInt()))
        }
        rec.stop()
    } finally {
        rec.release()
    }
    return peak
}

@Composable
private fun CameraTest(s: AppState) {
    val context = LocalContext.current
    var opened by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }
    Page {
        T("اختبار الكاميرا", style = JardType.title)
        T("نفتح تطبيق الكاميرا تبع الهاتف. جرّب الأمامية والخلفية، وارجع. جرد ما بيشوف الصور.", color = Jard.colors.inkQuiet)
        note?.let { Note(it, Jard.colors.statusWarn) }
        Btn("افتح الكاميرا", {
            val i = Intent(MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA)
            if (i.resolveActivity(context.packageManager) != null) {
                opened = true
                context.startActivity(i)
            } else {
                note = "ما لقينا تطبيق كاميرا."
            }
        }, Modifier.fillMaxWidth(), BtnKind.Primary, minHeight = 52.dp)
        if (opened) Answer(s, "اشتغلت الكاميرات وكانت الصورة واضحة؟", "camera") else Btn("رجوع", { s.goBack() }, Modifier.fillMaxWidth())
    }
}

@Composable
private fun VibrateTest(s: AppState) {
    val context = LocalContext.current
    var ran by remember { mutableStateOf(false) }
    Page {
        T("اختبار الاهتزاز", style = JardType.title)
        Btn("اهتز", {
            ran = true
            val v = context.getSystemService(Vibrator::class.java)
            v?.vibrate(VibrationEffect.createOneShot(800, VibrationEffect.DEFAULT_AMPLITUDE))
        }, Modifier.fillMaxWidth(), BtnKind.Primary, minHeight = 52.dp)
        if (ran) Answer(s, "اهتز الهاتف؟", "vibrate") else Btn("رجوع", { s.goBack() }, Modifier.fillMaxWidth())
    }
}

/* ---------- reports ---------- */

@Composable
private fun ReportRows(rows: List<ReportRow>) {
    Card {
        for (r in rows) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                T(r.key, Modifier.weight(1f))
                if (r.value.isNotEmpty()) Box(Modifier.weight(1f)) { Value(r.value) }
                TagWord(r.tag)
            }
        }
    }
}

@Composable
private fun ReportActions(report: DeviceReport, shop: String?) {
    val context = LocalContext.current
    var problem by remember { mutableStateOf<String?>(null) }
    problem?.let { Note(it, Jard.colors.statusSerious) }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Btn("مشاركة واتساب", { shareText(context, Reports.text(report, shop, I18n::tr), whatsapp = true) }, Modifier.weight(1f))
        Btn("حفظ PDF", {
            val rtl = !I18n.english
            runCatching { Reports.pdf(context, report, shop, rtl, I18n::tr) }
                .onSuccess { shareFile(context, it, "application/pdf") }
                .onFailure { problem = "ما انعمل ملف PDF: ${it.message}" }
        }, Modifier.weight(1f))
    }
}

/** What a seller shows a buyer. Only what was really checked, and it says so about the rest. */
@Composable
fun UsedScreen(s: AppState) {
    val context = LocalContext.current
    val report = remember(s.page, s.version) { Reports.build(context) }
    var saved by remember { mutableStateOf(false) }
    Page {
        Head(s, "تقرير حالة الهاتف", "${report.title} · ${Reports.dateText(report.date)}")
        GuestBanner(s)
        T("الخلاصة: ${I18n.tr(report.summary)}", weight = FontWeight.Bold)
        T("الفحص لا يكشف كل الأعطال، فجرّب الهاتف بنفسك قبل الشراء.", color = Jard.colors.inkQuiet)
        ReportRows(report.rows)
        if (report.rows.any { it.tag == RowTag.NotChecked }) {
            Muted("اللي مكتوب عليه غير مفحوص، ما انجرّب. جرّبه من هون:")
            ManualTestsList(s)
        }
        Muted("التقرير لا يحتوي صوراً أو حسابات أو رقم IMEI.")
        ReportActions(report, s.shopName.ifBlank { null })
        if (!s.guest) {
            Btn(if (saved) "انحفظ في السجل" else "احفظ في سجل الأجهزة", {
                ShopLog.add(context, report)
                saved = true
            }, Modifier.fillMaxWidth(), enabled = !saved)
        }
    }
}

/** A customer reads this before agreeing. It's their phone. */
@Composable
fun GuestScreen(s: AppState) {
    Page {
        T("وضع ضيف", style = JardType.title)
        T("هذا الفحص ما بيحفظ شي على هاتفك", style = JardType.heading, weight = FontWeight.Bold)
        Card {
            for (x in listOf("بلا حساب وبلا تسجيل دخول", "ما منفتح صورك ولا رسائلك", "كل شي بينمسح لما تضغط خروج")) T("• $x")
        }
        T("اللي رح ينفحص", weight = FontWeight.Bold)
        Card {
            for (x in listOf("المساحة والملفات الكبيرة", "البطارية والحساسات", "الشاشة واللمس والسماعة", "هل الجهاز مرووت أو معدّل")) T("• $x")
        }
        Muted("بيطلب إذن الوصول للملفات مرة وحدة، وبينتهي مع خروجك.")
        Muted("يمكن للزبون قراءة هذه الشاشة بنفسه قبل الموافقة.")
        if (s.guest) {
            Btn("اعرض التقرير", { s.page = Page.Used }, Modifier.fillMaxWidth(), BtnKind.Primary, minHeight = 52.dp)
            Btn("خروج ومسح", { s.leaveGuest() }, Modifier.fillMaxWidth(), BtnKind.Danger)
        } else {
            Btn("ابدأ الفحص", {
                s.enterGuest()
                s.page = Page.None
                s.tab = Tab.Check
            }, Modifier.fillMaxWidth(), BtnKind.Primary, minHeight = 52.dp)
            Btn("رجوع", { s.goBack() }, Modifier.fillMaxWidth())
        }
    }
}

@Composable
fun ShopLogScreen(s: AppState) {
    val context = LocalContext.current
    var version by remember { mutableStateOf(0) }
    val entries = remember(version, s.page) { ShopLog.list(context) }
    var query by remember { mutableStateOf("") }
    val today = remember(entries) { Reports.dateText(System.currentTimeMillis() / 1000) }
    val month = today.take(7)
    val shown = entries.filter { query.isBlank() || it.name.contains(query, ignoreCase = true) || I18n.tr(it.note).contains(query, ignoreCase = true) }
    Page {
        Head(s, "سجل الأجهزة")
        Muted("${entries.count { Reports.dateText(it.at) == today }} ${I18n.tr("اليوم")} · ${entries.count { Reports.dateText(it.at).startsWith(month) }} ${I18n.tr("هذا الشهر")}")
        Field(query, { query = it }, "ابحث في السجل")
        Btn("جهاز جديد", { s.page = Page.Guest }, Modifier.fillMaxWidth(), BtnKind.Primary)
        if (entries.isEmpty()) T("السجل فارغ. افتح تقرير الهاتف المستعمل واحفظه هون.", color = Jard.colors.inkQuiet)
        for (e in shown) EntryRow(e) {
            s.report = e.report
            s.page = Page.ShopReport
        }
        if (entries.size >= 2) Btn("قارن جهازين", { s.page = Page.ShopCompare }, Modifier.fillMaxWidth())
        if (entries.isNotEmpty()) Btn("تصدير", { shareFile(context, ShopLog.exportCsv(context, I18n::tr), "text/csv") }, Modifier.fillMaxWidth())
        Btn("إعداد المحل", { s.page = Page.ShopSetup }, Modifier.fillMaxWidth())
        Muted("السجل محفوظ على هذا الجهاز فقط.")
    }
}

@Composable
private fun EntryRow(e: ShopEntry, onClick: () -> Unit) {
    Column(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(role = Role.Button, onClick = onClick).padding(vertical = 6.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            T(e.name, Modifier.weight(1f), weight = FontWeight.SemiBold)
            TagWord(if (e.warnings == 0) RowTag.Good else RowTag.Warn)
        }
        Muted("${Reports.dateText(e.at)} · ${I18n.tr(e.note)}")
    }
}

@Composable
fun ShopReportScreen(s: AppState) {
    val report = s.report
    if (report == null) {
        s.goBack()
        return
    }
    Page {
        Head(s, s.shopName.ifBlank { "تقرير حالة الهاتف" }, "${report.title} · ${Reports.dateText(report.date)}")
        T(report.summary, weight = FontWeight.Bold)
        ReportRows(report.rows)
        Muted("ما في رقم IMEI ولا صور ولا حسابات في التقرير. الفحص لا يكشف كل عطل، فجرّب الجهاز بنفسك.")
        ReportActions(report, s.shopName.ifBlank { null })
    }
}

@Composable
fun ShopSetupScreen(s: AppState) {
    var name by remember { mutableStateOf(s.shopName) }
    Page {
        Head(s, "إعداد المحل", "يظهر اسم المحل أعلى التقارير اللي بتشاركها.")
        Field(name, { name = it }, "اسم المحل")
        Btn("حفظ", { s.setShop(name.trim()); s.goBack() }, Modifier.fillMaxWidth(), BtnKind.Primary)
    }
}

@Composable
fun ShopCompareScreen(s: AppState) {
    val context = LocalContext.current
    val entries = remember { ShopLog.list(context) }
    val picked = remember { mutableStateListOf<Long>() }
    Page {
        Head(s, "قارن جهازين", "اختر جهازين من السجل.")
        if (picked.size < 2) {
            for (e in entries) {
                CheckRow(e.id in picked, { on -> if (on) picked.add(e.id) else picked.remove(e.id) }, e.name) {
                    Column(Modifier.weight(1f)) {
                        T(e.name, weight = FontWeight.SemiBold)
                        Muted(Reports.dateText(e.at))
                    }
                }
            }
        } else {
            val a = entries.first { it.id == picked[0] }
            val b = entries.first { it.id == picked[1] }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.weight(1f))
                T(a.name, Modifier.weight(1f), weight = FontWeight.Bold)
                T(b.name, Modifier.weight(1f), weight = FontWeight.Bold)
            }
            for (key in (a.report.rows + b.report.rows).map { it.key }.distinct()) {
                val ra = a.report.rows.firstOrNull { it.key == key }
                val rb = b.report.rows.firstOrNull { it.key == key }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    T(key, Modifier.weight(1f), JardType.caption, Jard.colors.inkMuted)
                    CompareCell(ra, Modifier.weight(1f))
                    CompareCell(rb, Modifier.weight(1f))
                }
            }
            Btn("اختر جهازين غيرهم", { picked.clear() }, Modifier.fillMaxWidth())
        }
    }
}

@Composable
private fun CompareCell(r: ReportRow?, modifier: Modifier) {
    Column(modifier) {
        if (r == null) {
            T("—")
            return
        }
        if (r.value.isNotEmpty()) T(r.value, style = JardType.caption)
        TagWord(r.tag)
    }
}
