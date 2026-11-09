package app.jard.ui

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Intent
import android.provider.Settings
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.jard.design.Jard
import app.jard.design.JardData
import app.jard.design.JardType
import app.jard.engine.AppRecency
import app.jard.engine.AppUse
import app.jard.engine.BenchResult
import app.jard.engine.Device
import app.jard.engine.Facts
import app.jard.engine.Finding
import app.jard.engine.JardWidget
import app.jard.engine.LargeWidget
import app.jard.engine.NetworkUse
import app.jard.engine.PermissionUse
import app.jard.engine.SavedScans
import app.jard.engine.Security
import app.jard.engine.SmallWidget
import app.jard.engine.TrackerHit
import app.jard.engine.agoText
import app.jard.engine.sizeText
import kotlin.concurrent.thread

private data class Cause(val title: String, val metric: String, val plain: String, val cta: String, val go: (AppState) -> Unit)

/** No "speed up" button and no made-up score: what we can read, in order of how much it matters. */
@Composable
fun SlowScreen(s: AppState) {
    val context = LocalContext.current
    val causes = remember(s.version) {
        val out = ArrayList<Cause>()
        val storagePct = Facts.storageUsedPercent(context)
        val info = Device.info(context)
        val ramPct = if (info.ramTotal > 0) ((info.ramTotal - info.ramFree) * 100 / info.ramTotal).toInt() else 0
        val battery = Facts.battery(context)
        if (storagePct >= 75) out.add(Cause("التخزين شبه ممتلئ", "$storagePct%", "كلما امتلأ أكثر، بطؤت القراءة والكتابة.", "شوف أكبر الملفات") { it.page = Page.None; it.tab = Tab.Files })
        if (ramPct >= 80) out.add(Cause("الذاكرة ممتلئة الآن", "$ramPct%", "لما تمتلئ، أندرويد يسكر التطبيقات ويعيد فتحها، وهذا بطيء.", "شوف التطبيقات") { it.page = Page.None; it.tab = Tab.Apps })
        if (battery.tempC >= 40) out.add(Cause("الهاتف سخن", "${battery.tempC}°C", "لما يسخن، يخفض الهاتف سرعة المعالج ليحمي نفسه.", "تفاصيل البطارية") { it.page = Page.Battery })
        if (!battery.healthy) out.add(Cause("البطارية تعبانة", battery.healthWord, "قد يخفض الهاتف الأداء أحياناً لما تضعف البطارية.", "تفاصيل البطارية") { it.page = Page.Battery })
        if (Device.hasUsageAccess(context)) {
            val active = AppRecency.activeLastDay(context)
            if (active >= 40) out.add(Cause("تطبيقات كثيرة شغالة", "$active", "فتحت هذا العدد من التطبيقات خلال يوم. كل واحد ممكن يضل شغال بالخلفية.", "شوف التطبيقات") { it.page = Page.None; it.tab = Tab.Apps })
        }
        out
    }
    Page {
        Head(s, "ليش هاتفي بطيء؟")
        T(if (causes.isEmpty()) "ما لقينا سبباً واضحاً في القراءات" else "أكبر سبب: ${I18n.tr(causes[0].title)}", style = JardType.title.copy(fontSize = 22.sp))
        for (c in causes) {
            Card {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    T(c.title, Modifier.weight(1f), weight = FontWeight.SemiBold)
                    Num(c.metric)
                }
                T(c.plain, color = Jard.colors.inkQuiet)
                Btn(c.cta, { c.go(s) }, Modifier.fillMaxWidth())
            }
        }
        if (causes.isEmpty()) T("التخزين والذاكرة والحرارة والبطارية كلها ضمن الطبيعي الآن. البطء ممكن يكون من تطبيق واحد أو من عمر الجهاز.", color = Jard.colors.inkQuiet)
        Muted("ما في زر \"تسريع\" سحري. نوضح السبب، وأنت تقرر.")
    }
}

@Composable
fun DeviceScreen(s: AppState) {
    val context = LocalContext.current
    val hardware = remember { Facts.hardware(context) }
    val system = remember { Facts.system() }
    Page {
        Head(s, "معلومات الجهاز", "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}")
        T("العتاد", weight = FontWeight.SemiBold)
        Card { for (f in hardware) FactRow(f.key, f.value) }
        T("النظام", weight = FontWeight.SemiBold)
        Card { for (f in system) FactRow(f.key, f.value) }
    }
}

/** A capacity test that needs no background service: two readings, however far apart. */
@Composable
fun BatteryScreen(s: AppState) {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("jard", android.content.Context.MODE_PRIVATE) }
    var version by remember { mutableStateOf(0) }
    val b = remember(version) { Facts.battery(context) }
    val startPct = prefs.getInt("capPct", -1)
    val startMah = prefs.getInt("capMah", -1)
    Page {
        Head(s, "صحة البطارية")
        T(b.healthWord, style = JardType.title)
        Muted("حسب ما يبلغ عنه النظام. نسبة الصحة الدقيقة لا توفرها معظم الأجهزة، فما منخمّنها.")
        Card {
            FactRow("الشحن", "${b.percent}%${if (b.charging) " · ${I18n.tr("يشحن")}" else ""}")
            FactRow("دورات الشحن", b.cycles?.toString() ?: "غير متاحة")
            FactRow("الحرارة", "${b.tempC}°C")
            FactRow("الجهد", "${b.volts} V")
            FactRow("النوع", b.technology.ifEmpty { "—" })
            FactRow("السعة الأصلية", b.designMah?.let { "$it mAh" } ?: "غير متاحة")
            FactRow("الشحنة الآن", b.chargeNowMah?.let { "$it mAh" } ?: "غير متاحة")
        }
        T("اختبار السعة", weight = FontWeight.SemiBold)
        T("يقيس الشحن الفعلي أثناء التفريغ. ابدأ وأنت مش شاحن، واستخدم الهاتف عادي، وارجع لما تنزل البطارية 15% على الأقل.", color = Jard.colors.inkQuiet)
        val mah = b.chargeNowMah
        if (mah == null) {
            Note("هذا الجهاز ما بيبلغ عن الشحنة، فالاختبار غير متاح عليه.", Jard.colors.statusWarn)
        } else if (startPct < 0) {
            Btn("بدء الاختبار", {
                prefs.edit().putInt("capPct", b.percent).putInt("capMah", mah).apply()
                version++
            }, Modifier.fillMaxWidth(), enabled = !b.charging)
            if (b.charging) Muted("افصل الشاحن أولاً.")
        } else {
            val dropped = startPct - b.percent
            if (dropped >= 15 && startMah > mah) {
                val full = (startMah - mah) * 100 / dropped
                Card {
                    FactRow("السعة المقدّرة", "$full mAh")
                    b.designMah?.let { FactRow("من الأصلية", "${full * 100 / it}%") }
                }
                Muted("تقدير من نزول $dropped%. كلما نزلت أكثر كان أدق.")
            } else {
                Muted("بدأ من $startPct%. لازم تنزل 15% على الأقل، والآن ${b.percent}%.")
            }
            Btn("إعادة الاختبار", {
                prefs.edit().remove("capPct").remove("capMah").apply()
                version++
            }, Modifier.fillMaxWidth())
        }
    }
}

@Composable
fun BenchScreen(s: AppState) {
    val context = LocalContext.current
    var result by remember { mutableStateOf<BenchResult?>(null) }
    var busy by remember { mutableStateOf(false) }
    var color by remember { mutableStateOf("white") }
    val pixelColors = listOf("white" to "أبيض", "black" to "أسود", "red" to "أحمر", "green" to "أخضر", "blue" to "أزرق")
    Page {
        Head(s, "السرعة والشاشة")
        Card {
            FactRow("قراءة التخزين", result?.let { "%,.0f MB/s".format(java.util.Locale.US, it.readMbS) } ?: "—")
            FactRow("كتابة التخزين", result?.let { "%,.0f MB/s".format(java.util.Locale.US, it.writeMbS) } ?: "—")
            FactRow("سرعة الذاكرة", result?.let { "%.1f GB/s".format(java.util.Locale.US, it.memoryGbS) } ?: "—")
        }
        Btn(if (busy) "يقيس…" else if (result != null) "إعادة الاختبار" else "بدء اختبار السرعة", {
            busy = true
            thread {
                result = runCatching { Facts.bench(context) }.getOrNull()
                busy = false
            }
        }, Modifier.fillMaxWidth(), enabled = !busy)
        Muted("يكتب ملفاً مؤقتاً 64 MB ثم يحذفه.")
        T("فحص البيكسلات الميتة", weight = FontWeight.SemiBold)
        T("اختر لوناً وافتحه على كامل الشاشة. أي نقطة مختلفة تعني مشكلة في البيكسل.", color = Jard.colors.inkQuiet)
        Tabs(pixelColors, color) { color = it }
        Btn("فتح على كامل الشاشة", { s.testing = "pixels:$color"; s.page = Page.Pixels }, Modifier.fillMaxWidth())
    }
}

/** A solid colour. A tap anywhere goes back. */
@Composable
fun PixelsScreen(s: AppState) {
    val color = when (s.testing.substringAfter(':')) {
        "black" -> Color.Black
        "red" -> Color.Red
        "green" -> Color.Green
        "blue" -> Color.Blue
        else -> Color.White
    }
    Box(Modifier.fillMaxSize().background(color).clickable(role = Role.Button, onClickLabel = I18n.tr("رجوع")) { s.goBack() })
}

@Composable
fun SecurityScreen(s: AppState) {
    val context = LocalContext.current
    var tab by remember { mutableStateOf("find") }
    var finds by remember { mutableStateOf<List<Finding>?>(null) }
    var perms by remember { mutableStateOf<List<PermissionUse>?>(null) }
    var trackers by remember { mutableStateOf<List<TrackerHit>?>(null) }
    var progress by remember { mutableStateOf<Pair<Int, Int>?>(null) }
    LaunchedEffect(Unit) {
        thread {
            finds = runCatching { Security.findings(context) }.getOrDefault(emptyList())
            perms = runCatching { Security.permissions(context) }.getOrDefault(emptyList())
        }
    }
    Page {
        Head(s, "الأمان", "ملاحظة: وجود شيء هنا لا يعني أنه ضار. راجعه وقرر.")
        Tabs(listOf("find" to "النتائج", "perm" to "الصلاحيات", "track" to "المتتبعات"), tab) { tab = it }
        when (tab) {
            "find" -> {
                val f = finds
                if (f == null) Muted("يقرأ…")
                else if (f.isEmpty()) T("ما لقينا شي يستاهل المراجعة. هذا لا يضمن إن الجهاز آمن تماماً.", color = Jard.colors.inkQuiet)
                else for (x in f) Card(borderColor = if (x.warn) Jard.colors.statusWarn else Jard.colors.line) {
                    T(x.title, weight = FontWeight.SemiBold)
                    T(x.apps.joinToString(" · "), color = Jard.colors.ink)
                    Muted(x.why)
                }
            }
            "perm" -> {
                val p = perms
                if (p == null) Muted("يقرأ…")
                else for (x in p) Card {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        T(x.name, Modifier.weight(1f), weight = FontWeight.SemiBold)
                        Num(x.apps.size.toString())
                    }
                    Muted(x.apps.take(6).joinToString(" · ") + if (x.apps.size > 6) " …" else "")
                }
                Btn("صلاحيات التطبيقات بالنظام", { context.startActivity(Intent(Settings.ACTION_APPLICATION_SETTINGS)) }, Modifier.fillMaxWidth())
            }
            else -> {
                T("مكتبات تحليل وإعلانات داخل التطبيقات، حسب بصماتها المعروفة. نقرأ ملف كل تطبيق على هذا الهاتف فقط، فممكن ياخد دقائق.", color = Jard.colors.inkQuiet)
                val t = trackers
                val running = progress
                when {
                    running != null -> Muted("يفحص ${running.first} من ${running.second}…")
                    t == null -> Btn("ابدأ الكشف", {
                        progress = 0 to 1
                        thread {
                            trackers = runCatching { Security.scanTrackers(context, { a, b -> progress = a to b }) { false } }.getOrDefault(emptyList())
                            progress = null
                        }
                    }, Modifier.fillMaxWidth())
                    t.isEmpty() -> T("ما لقينا متتبعات من اللي بنعرفها. القائمة مش كاملة.", color = Jard.colors.inkQuiet)
                    else -> for (x in t) Card {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            T(x.app, Modifier.weight(1f), weight = FontWeight.Medium)
                            Num(x.trackers.size.toString())
                        }
                        Muted(x.trackers.joinToString(" · "))
                    }
                }
            }
        }
    }
}

@Composable
fun NetworkScreen(s: AppState, resumed: Int) {
    val context = LocalContext.current
    var tab by remember { mutableStateOf("data") }
    val hasUsage = remember(resumed) { Device.hasUsageAccess(context) }
    var rows by remember { mutableStateOf<List<AppUse>?>(null) }
    LaunchedEffect(hasUsage) {
        if (hasUsage) thread { rows = runCatching { NetworkUse.thisMonth(context) }.getOrDefault(emptyList()) }
    }
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Head(s, "الشبكة")
        Tabs(listOf("data" to "الاستهلاك", "wifi" to "الأجهزة", "ports" to "المنافذ"), tab) { tab = it }
        when (tab) {
            "data" -> {
                Muted("استهلاك الإنترنت لكل تطبيق خلال هذا الشهر، من عدّادات النظام.")
                if (!hasUsage) {
                    T("يحتاج إذن «الوصول إلى الاستخدام».", color = Jard.colors.inkQuiet)
                    Btn("فتح إعدادات الإذن", { context.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)) }, Modifier.fillMaxWidth(), BtnKind.Primary)
                } else {
                    val r = rows
                    if (r == null) Muted("يقرأ…")
                    else if (r.isEmpty()) Muted("ما في قراءات لهذا الشهر.")
                    else {
                        val max = r.first().total.coerceAtLeast(1)
                        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            items(r, key = { it.pkg }) { a ->
                                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        T(a.name, Modifier.weight(1f), weight = FontWeight.Medium)
                                        Num(sizeText(a.total))
                                    }
                                    ShareBar(a.total.toFloat() / max, JardData.d2)
                                    Muted("Wi-Fi ${ltr(sizeText(a.wifi))} · ${I18n.tr("بيانات الجوال")} ${ltr(sizeText(a.mobile))}")
                                }
                            }
                        }
                    }
                }
            }
            else -> {
                T("هذا القسم يحتاج اتصالاً بالشبكة.", weight = FontWeight.SemiBold)
                T("فحص الأجهزة والمنافذ يحتاج إذن الإنترنت، وجَرد على أندرويد ما عنده هذا الإذن عن قصد: هيك مستحيل يطلع منه شي. نسخة الكمبيوتر فيها هذا الفحص.", color = Jard.colors.inkQuiet)
            }
        }
    }
}

/** What grew since the last scan. */
@Composable
fun CompareScreen(s: AppState) {
    val context = LocalContext.current
    val list = remember(s.version) { SavedScans.summaries(context) }
    Page {
        Head(s, "شو كبر من آخر فحص")
        if (list.size < 2) {
            T("يلزم فحصان على الأقل للمقارنة.", color = Jard.colors.inkQuiet)
            Btn("فحص جديد", { s.startScan() }, Modifier.fillMaxWidth(), BtnKind.Primary)
        } else {
            val a = list[list.size - 2]
            val b = list.last()
            val delta = b.onDisk - a.onDisk
            Muted("بين ${I18n.tr(agoText(a.at))} و${I18n.tr(agoText(b.at))}")
            T(if (delta >= 0) "زاد ${ltr(sizeText(delta))}" else "نقص ${ltr(sizeText(-delta))}", style = JardType.title)
            val changes = remember(a, b) { SavedScans.changes(a, b) }
            if (changes.isEmpty()) Muted("ما في تغيير في المجلدات الرئيسية.")
            for (c in changes.take(30)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    T(c.name, Modifier.weight(1f))
                    Num((if (c.delta > 0) "+" else "−") + sizeText(kotlin.math.abs(c.delta)), color = if (c.delta > 0) Jard.colors.statusWarn else Jard.colors.statusGood)
                }
            }
        }
    }
}

@Composable
fun WidgetsScreen(s: AppState) {
    val context = LocalContext.current
    val storage = s.storage
    val am = remember { AppWidgetManager.getInstance(context) }
    var note by remember { mutableStateOf<String?>(null) }
    fun pin(cls: Class<*>) {
        if (android.os.Build.VERSION.SDK_INT >= 26 && am.isRequestPinAppWidgetSupported) {
            am.requestPinAppWidget(ComponentName(context, cls), null, null)
        } else {
            note = "هذا الهاتف ما بيسمح بالإضافة من هون. اضغط مطولاً على الشاشة الرئيسية واختر الويدجت."
        }
    }
    Page {
        Head(s, "الويدجت والإشعارات")
        note?.let { Note(it, Jard.colors.statusWarn) }
        Card {
            T("ويدجت كبير", weight = FontWeight.SemiBold)
            Muted("التخزين")
            Num("${sizeText(storage.used)} / ${sizeText(storage.total)}", size = 18)
            ShareBar(storage.used.toFloat() / storage.total.coerceAtLeast(1), Jard.colors.accent, height = 6.dp)
            Btn("أضف للشاشة الرئيسية", { pin(LargeWidget::class.java) }, Modifier.fillMaxWidth())
        }
        Card {
            T("ويدجت صغير", weight = FontWeight.SemiBold)
            Muted("متاح")
            Num(sizeText(storage.free), size = 18)
            Btn("أضف للشاشة الرئيسية", { pin(SmallWidget::class.java) }, Modifier.fillMaxWidth())
        }
        T("الإشعارات", weight = FontWeight.SemiBold)
        Card {
            T("المساحة وصلت 90%", weight = FontWeight.Medium)
            Muted("افتح جرد لتعرف شو ماخذها.")
        }
        Card {
            T("انتهى الفحص الأسبوعي", weight = FontWeight.Medium)
            Muted("يخبرك شو كبر هذا الأسبوع.")
        }
        Btn("تشغيلها من الإعدادات", { s.page = Page.Settings }, Modifier.fillMaxWidth())
        LaunchedEffect(Unit) { JardWidget.refresh(context) }
    }
}
