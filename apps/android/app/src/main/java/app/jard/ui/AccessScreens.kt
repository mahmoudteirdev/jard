package app.jard.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.jard.design.Jard
import app.jard.design.JardType
import app.jard.engine.ActivateResult
import app.jard.engine.Facts
import app.jard.engine.KeyCheck
import app.jard.engine.Licensing
import app.jard.engine.Privileged
import app.jard.engine.agoText
import app.jard.engine.getprop
import app.jard.engine.sizeText
import kotlin.concurrent.thread

private data class Tier(val id: String, val name: String, val tag: String, val what: String, val fill: Int, val rows: List<Pair<Char, String>>)

/** Three levels, and root isn't the only way. Each says what it opens and what it doesn't. */
@Composable
fun AccessScreen(s: AppState, resumed: Int) {
    val context = LocalContext.current
    val running = remember(resumed) { Privileged.shizukuRunning() }
    var granted by remember(resumed) { mutableStateOf(Privileged.shizukuGranted()) }
    var open by remember { mutableStateOf("shizuku") }
    val tiers = listOf(
        Tier("normal", "عادي", "مفعّل", "بلا أي إعداد. يكفي معظم الناس.", 1, listOf('✓' to "ملفاتك وصورك والتنزيلات", '~' to "أحجام التطبيقات من النظام", '×' to "Android/data ومجلدات النظام")),
        Tier("shizuku", "Shizuku", "مقترح", "عبر تصحيح الأخطاء. بدون روت وبدون فقدان الضمان.", 2, listOf('✓' to "Android/data", '✓' to "مسح كاش التطبيقات فعلياً", '×' to "/data/data وملفات النظام")),
        Tier("root", "روت", "للخبراء", "كل شي، ومعه كل المسؤولية.", 3, listOf('✓' to "كل المجلدات بلا استثناء", '✓' to "سجل النظام والطرفية", '~' to "قد يمنع تحديثات الشركة وبعض التطبيقات")),
    )
    Page {
        Head(s, "كم بتشوف من جهازك؟", "ثلاث طبقات، وكل واحدة بتفتح أكثر. الروت ليس الخيار الوحيد.")
        for (t in tiers) {
            val on = open == t.id
            Column(
                Modifier.fillMaxWidth().background(if (on) Jard.colors.surfaceRaised else Color.Transparent)
                    .border(BorderStroke(1.dp, if (on) Jard.colors.accent else Jard.colors.line))
                    .clickable(role = Role.Button) { open = t.id }.padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    T(t.name, Modifier.weight(1f), weight = FontWeight.Bold)
                    T(t.tag, style = JardType.label, color = Jard.colors.inkMuted)
                }
                Muted(t.what)
                Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                    for (i in 1..3) Box(Modifier.weight(1f).height(4.dp).background(if (i <= t.fill) Jard.colors.accent else Jard.colors.line))
                }
                if (on) for ((mark, text) in t.rows) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Num(mark.toString(), Modifier.width(14.dp), color = when (mark) { '✓' -> Jard.colors.statusGood; '~' -> Jard.colors.statusWarn; else -> Jard.colors.statusSerious })
                        T(text, Modifier.weight(1f))
                    }
                }
            }
        }
        when (open) {
            "normal" -> T("شغّال الآن.", color = Jard.colors.statusGood)
            "shizuku" -> {
                T("إعداد Shizuku", weight = FontWeight.Bold)
                when {
                    granted -> {
                        T("Shizuku مربوط. صار بنقدر نقرأ Android/data ونمسح الكاش.", color = Jard.colors.statusGood)
                        PrivilegedFolders("/storage/emulated/0/Android/data")
                    }
                    running -> {
                        T("Shizuku شغال، وناقص تسمح لجرد يستخدمه.", color = Jard.colors.inkQuiet)
                        Btn("السماح لجرد", {
                            Privileged.requestShizuku(1)
                            granted = Privileged.shizukuGranted()
                        }, Modifier.fillMaxWidth(), BtnKind.Primary)
                    }
                    else -> {
                        T("Shizuku تطبيق مستقل ومجاني. ركّبه من المتجر، وفعّل \"خيارات المطوّر\" ثم \"تصحيح الأخطاء عبر الواي فاي\"، واتبع خطوات الإقران داخله. يبقى فعّالاً حتى تعيد تشغيل الهاتف.", color = Jard.colors.inkQuiet)
                        Muted("الإقران بيصير من داخل Shizuku: جرد ما عنده إذن شبكة ليعملها بنفسه. ما منرسل شي للإنترنت.")
                        Btn("افتح Shizuku", {
                            val i = context.packageManager.getLaunchIntentForPackage("moe.shizuku.privileged.api")
                            if (i != null) context.startActivity(i)
                            else context.startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse("market://details?id=moe.shizuku.privileged.api")))
                        }, Modifier.fillMaxWidth())
                    }
                }
            }
            else -> Btn("متابعة لطلب الروت", { s.page = Page.Root }, Modifier.fillMaxWidth(), BtnKind.Primary)
        }
    }
}

/** What's inside a closed folder. Only ever reads. */
@Composable
private fun PrivilegedFolders(path: String) {
    val context = LocalContext.current
    var rows by remember(path) { mutableStateOf<List<Pair<String, Long>>?>(null) }
    LaunchedEffect(path) { thread { rows = runCatching { Privileged.folderSizes(context, path) }.getOrDefault(emptyList()) } }
    val r = rows
    if (r == null) Muted("يقرأ…")
    else if (r.isEmpty()) Muted("ما قدرنا نقرأ هذا المجلد.")
    else Card {
        Num(path, size = 12, color = Jard.colors.inkMuted)
        for ((p, bytes) in r.take(30)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.weight(1f)) { Num(p.substringAfterLast('/'), size = 12) }
                Num(sizeText(bytes), size = 12)
            }
        }
    }
}

private val ROOT_CAPS = listOf(
    Triple("ملفاتك وصورك", "نعم", "نعم"),
    Triple("أحجام التطبيقات", "جزئي", "نعم"),
    Triple("Android/data", "لا", "نعم"),
    Triple("بيانات التطبيقات الخاصة", "لا", "نعم"),
    Triple("ملفات النظام", "لا", "نعم"),
)

@Composable
fun RootScreen(s: AppState) {
    var state by remember { mutableStateOf(if (s.rootOn) "granted" else "idle") }
    var busy by remember { mutableStateOf(false) }
    fun request() {
        busy = true
        thread {
            val ok = Privileged.requestRoot()
            s.setRoot(ok)
            state = if (ok) "granted" else "denied"
            busy = false
        }
    }
    Page {
        Head(s, "صلاحية الروت", "اختيارية. التطبيق يعمل بدونها، لكن الفحص يبقى محدوداً بما يسمح به أندرويد.")
        Card {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                T("القدرة", Modifier.weight(2f), JardType.caption, Jard.colors.inkMuted)
                T("بدون", Modifier.weight(1f), JardType.caption, Jard.colors.inkMuted)
                T("مع روت", Modifier.weight(1f), JardType.caption, Jard.colors.inkMuted)
            }
            for ((name, no, yes) in ROOT_CAPS) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    T(name, Modifier.weight(2f))
                    T(no, Modifier.weight(1f), color = if (no == "نعم") Jard.colors.statusGood else if (no == "جزئي") Jard.colors.statusWarn else Jard.colors.statusSerious)
                    T(yes, Modifier.weight(1f), color = Jard.colors.statusGood)
                }
            }
        }
        T("حدود الاستخدام", weight = FontWeight.Bold)
        T("قراءة فقط بشكل افتراضي. كل حذف بصلاحية الروت يحتاج تأكيداً منفصلاً. كل أمر ينفذ يُسجّل وتقدر تراجعه.", color = Jard.colors.inkQuiet)
        when (state) {
            "granted" -> {
                T("الصلاحية مفعّلة", color = Jard.colors.statusGood, weight = FontWeight.Bold)
                Num("$ du -k -d 1 /data/data (read-only)", size = 12, color = Jard.colors.inkMuted)
                PrivilegedFolders("/data/data")
                Btn("إيقاف الصلاحية", { s.setRoot(false); state = "idle" }, Modifier.fillMaxWidth())
            }
            "denied" -> {
                Note("ما وصلت الصلاحية. الجهاز غير مروّت، أو تم الرفض من مدير الروت. الفحص العادي شغال.", Jard.colors.statusWarn)
                Btn(if (busy) "ينتظر…" else "إعادة المحاولة", { request() }, Modifier.fillMaxWidth(), enabled = !busy)
                Btn("متابعة بدون روت", { s.goBack() }, Modifier.fillMaxWidth())
            }
            else -> {
                Btn(if (busy) "ينتظر…" else "طلب الصلاحية", { request() }, Modifier.fillMaxWidth(), BtnKind.Primary, enabled = !busy)
                Btn("متابعة بدون روت", { s.goBack() }, Modifier.fillMaxWidth())
            }
        }
    }
}

@Composable
fun ExpertScreen(s: AppState) {
    val context = LocalContext.current
    var tab by remember { mutableStateOf("sys") }
    val boot = remember { Facts.boot() }
    var log by remember { mutableStateOf<String?>(null) }
    var command by remember { mutableStateOf("") }
    var terminal by remember { mutableStateOf("") }
    var confirming by remember { mutableStateOf(false) }
    Page {
        Head(s, "أدوات الخبير", if (s.rootOn) null else "السجل والطرفية يحتاجان روت.")
        Tabs(listOf("sys" to "النظام", "log" to "السجل", "term" to "الطرفية", "hist" to "الأوامر"), tab) { tab = it }
        when (tab) {
            "sys" -> Card {
                FactRow("Bootloader", when (boot.bootloaderLocked) { true -> "locked"; false -> "unlocked"; null -> "—" })
                FactRow("Verified Boot", boot.verifiedBoot.ifEmpty { "—" })
                FactRow("SELinux", boot.selinux.ifEmpty { getprop("ro.build.selinux").ifEmpty { "—" } })
                FactRow("Root", if (boot.rooted) "مكتشف" else "غير مكتشف")
                FactRow("ABI", android.os.Build.SUPPORTED_ABIS.joinToString(", "))
                FactRow("Build", android.os.Build.DISPLAY)
            }
            "log" -> {
                if (!s.rootOn) {
                    T("قراءة سجل النظام تحتاج روت.", color = Jard.colors.inkQuiet)
                    Btn("طلب الصلاحية", { s.page = Page.Root }, Modifier.fillMaxWidth())
                } else {
                    Btn("اقرأ آخر 200 سطر", {
                        thread { log = Privileged.rootCommand(context, "logcat -d -t 200").out }
                    }, Modifier.fillMaxWidth())
                    log?.let { Num(it, size = 11) }
                }
            }
            "term" -> {
                if (!s.rootOn) {
                    T("الطرفية تحتاج روت.", color = Jard.colors.inkQuiet)
                    Btn("طلب الصلاحية", { s.page = Page.Root }, Modifier.fillMaxWidth())
                } else {
                    Note("الأوامر تعمل بصلاحية كاملة وبعضها لا يمكن الرجوع عنه. كل أمر يُسجّل.", Jard.colors.statusSerious)
                    if (terminal.isNotEmpty()) Num(terminal, size = 12)
                    Field(command, { command = it; confirming = false }, "أمر", mono = true)
                    if (confirming) {
                        Btn("نفّذ بصلاحية الروت", {
                            val c = command
                            confirming = false
                            thread {
                                val r = Privileged.rootCommand(context, c)
                                terminal = (terminal + "# $c\n" + r.out).takeLast(8000)
                            }
                        }, Modifier.fillMaxWidth(), BtnKind.Danger)
                    } else {
                        Btn("تنفيذ", { if (command.isNotBlank()) confirming = true }, Modifier.fillMaxWidth())
                    }
                }
            }
            else -> {
                val h = remember(tab, terminal, log) { Privileged.history(context) }
                if (h.isEmpty()) Muted("ما انعمل أي أمر بصلاحية إضافية.")
                for ((at, via, cmd) in h.take(50)) {
                    Column {
                        Num(cmd, size = 12)
                        Muted("$via · ${I18n.tr(agoText(at))}")
                    }
                }
            }
        }
    }
}

/* ---------- Pro ---------- */

@Composable
fun ProScreen(s: AppState) {
    val context = LocalContext.current
    Page {
        Head(s, "جَرد Pro", "الفحص كامل في المجاني. Pro للأتمتة والتقارير.")
        Note("حتى الآن كل الميزات مفتوحة للجميع: السعر وحدود التجربة لسا ما انحددوا. التفعيل شغال ليكون جاهز.", Jard.colors.statusGood)
        Card {
            for (f in listOf("فحص تلقائي وتنبيه عند قرب الامتلاء", "مقارنة الفحوص وشو كبر هذا الشهر", "تقرير الهاتف المستعمل بصيغة PDF", "تدقيق الصلاحيات والمتتبعات كاملاً", "الويدجت على الشاشة الرئيسية")) T("+ $f")
        }
        val key = s.proKey
        if (key != null) {
            T("تم التفعيل. نفس الجهاز، بدون أي اتصال.", color = Jard.colors.statusGood, weight = FontWeight.Bold)
            Num(key)
            Btn("إلغاء التفعيل على هذا الجهاز", { Licensing.deactivate(context); s.refreshPro() }, Modifier.fillMaxWidth())
        } else {
            T("دفعة واحدة، بدون اشتراك شهري.", weight = FontWeight.SemiBold)
            Btn("التفعيل بدون إنترنت", { s.page = Page.Key }, Modifier.fillMaxWidth(), BtnKind.Primary)
        }
        Muted("بدون إعلانات، وبدون تتبّع، وبدون قفل نتائج فحص سابق. إذا انتهت التجربة، يرجع التطبيق للمجاني ولا يتوقف.")
    }
}

@Composable
fun KeyScreen(s: AppState) {
    val context = LocalContext.current
    val code = remember { Licensing.deviceCode(context) }
    var text by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var copied by remember { mutableStateOf(false) }
    fun apply(input: String) {
        error = null
        val trimmed = input.trim()
        if (!trimmed.startsWith("{")) {
            error = when (val c = Licensing.checkKey(trimmed)) {
                is KeyCheck.Short -> "ناقص ${c.missing} خانات. انسخ المفتاح كاملاً من الرسالة."
                is KeyCheck.Long -> "فيه ${c.extra} خانات زيادة. انسخ المفتاح كما هو."
                KeyCheck.BadCharacter -> "فيه حرف غير مسموح. المفتاح أحرف إنجليزية وأرقام."
                is KeyCheck.Ok -> "شكل المفتاح سليم، بس التفعيل بدو ملف التفعيل كله. افتح الملف اللي وصلك، أو الصق نصه هون."
            }
            return
        }
        when (val r = Licensing.activate(context, trimmed)) {
            is ActivateResult.Done -> {
                s.refreshPro()
                s.goBack()
            }
            ActivateResult.Unreadable -> error = "هذا مش ملف تفعيل."
            ActivateResult.BadSignature -> error = "التوقيع غير صحيح: الملف تغيّر أو مش من جرد."
            ActivateResult.OtherDevice -> error = "هذا الملف لجهاز ثاني. ابعت رمز هذا الجهاز لتاخد ملفه."
        }
    }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            val content = runCatching { context.contentResolver.openInputStream(uri)?.use { it.bufferedReader().readText() } }.getOrNull()
            if (content != null) {
                text = content
                apply(content)
            } else {
                error = "ما قدرنا نقرأ الملف."
            }
        }
    }
    Page {
        Head(s, "تفعيل بدون إنترنت", "لما الشراء من المتجر ما بيزبط من بلدك.")
        T("1. انسخ رمز جهازك", weight = FontWeight.Bold)
        Card {
            Muted("للقراءة فقط")
            Num(code, size = 16)
            Btn(if (copied) "انسخ" else "نسخ الرمز", {
                context.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("Jard", code))
                copied = true
            }, Modifier.fillMaxWidth())
        }
        T("2. ابعته وخذ ملف التفعيل", weight = FontWeight.Bold)
        Btn("افتح واتساب برسالة جاهزة", {
            shareText(context, I18n.tr("بدي أفعّل جَرد Pro.") + "\n$code\n${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}", whatsapp = true)
        }, Modifier.fillMaxWidth())
        Muted("الرسالة فيها الرمز والطراز فقط.")
        T("3. افتح الملف أو الصق نصه", weight = FontWeight.Bold)
        Btn("فتح ملف التفعيل", { pick.launch(arrayOf("*/*")) }, Modifier.fillMaxWidth())
        Field(text, { text = it }, "ملف التفعيل أو المفتاح", error = error, mono = true, minLines = 2)
        Btn("تفعيل", { apply(text) }, Modifier.fillMaxWidth(), BtnKind.Primary, enabled = text.isNotBlank())
        Muted("ملف التفعيل لهذا الجهاز فقط، وبيشتغل بدون أي اتصال.")
    }
}
