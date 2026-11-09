package app.jard.ui

import android.content.Intent
import android.net.Uri
import android.provider.Settings
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
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
import androidx.compose.ui.unit.sp
import app.jard.design.Jard
import app.jard.design.JardData
import app.jard.design.JardType
import app.jard.engine.Device
import app.jard.engine.Explain
import app.jard.engine.FileKind
import app.jard.engine.FileNode
import app.jard.engine.MoveResult
import app.jard.engine.Privileged
import app.jard.engine.QuarantineItem
import app.jard.engine.Safety
import app.jard.engine.Suggestions
import app.jard.engine.kindTotals
import app.jard.engine.protectedReason
import app.jard.engine.sizeText

/** Say what the app is, ask for what it needs and why, and how much detail to show. */
@Composable
fun OnboardScreen(s: AppState, resumed: Int) {
    val context = LocalContext.current
    var step by remember { mutableStateOf(1) }
    var simple by remember { mutableStateOf(!s.onboarded || s.simple) }
    var asked by remember { mutableStateOf(0) }
    val storage = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { asked++ }
    val notify = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { asked++ }
    val hasFiles = remember(resumed, asked) { Device.hasAllFiles(context) }
    val hasUsage = remember(resumed, asked) { Device.hasUsageAccess(context) }
    val hasNotify = remember(resumed, asked) { app.jard.engine.Automation.canNotify(context) }
    Page {
        Muted("الخطوة {} من 3".replace("{}", step.toString()))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            for (i in 1..3) Box(Modifier.weight(1f).height(4.dp).background(if (i <= step) Jard.colors.accent else Jard.colors.line))
        }
        when (step) {
            1 -> {
                Column(Modifier.width(56.dp).padding(vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Box(Modifier.fillMaxWidth().height(12.dp).background(JardData.d1))
                    Box(Modifier.fillMaxWidth(0.7f).height(12.dp).background(JardData.d2))
                    Box(Modifier.fillMaxWidth(0.4f).height(12.dp).background(JardData.d3))
                }
                T("اعرف شو جوّا هاتفك", style = JardType.title.copy(fontSize = 30.sp))
                T("نفحص التخزين والتطبيقات والبطارية والأمان، ونشرح النتيجة بكلام واضح.", color = Jard.colors.inkQuiet)
                T("يعمل بدون إنترنت. نتائج الفحص تبقى على هاتفك.", color = Jard.colors.inkQuiet)
                Tabs(listOf("ar" to "العربية", "en" to "English"), if (I18n.english) "en" else "ar") { I18n.setLanguage(context, it == "en") }
                Btn("التالي", { step = 2 }, Modifier.fillMaxWidth(), BtnKind.Primary, minHeight = 52.dp)
            }
            2 -> {
                Title("الصلاحيات، وليش نحتاجها")
                PermissionCard("الوصول لكل الملفات", "لحساب أحجام المجلدات وإيجاد الملفات الكبيرة.", hasFiles) {
                    if (android.os.Build.VERSION.SDK_INT >= 30) {
                        context.startActivity(Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:${context.packageName}")))
                    } else {
                        storage.launch(Device.LEGACY_STORAGE)
                    }
                }
                PermissionCard("بيانات الاستخدام", "لمعرفة أحجام التطبيقات وآخر استخدام واستهلاك الإنترنت.", hasUsage) {
                    context.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
                }
                PermissionCard("الإشعارات (اختياري)", "لتنبيهك عند قرب امتلاء المساحة.", hasNotify) {
                    if (android.os.Build.VERSION.SDK_INT >= 33) notify.launch(android.Manifest.permission.POST_NOTIFICATIONS)
                }
                Muted("كلها اختيارية. اللي ما بتسمح فيه، بنقولك شو ناقص بسببه.")
                Btn("متابعة", { step = 3 }, Modifier.fillMaxWidth(), BtnKind.Primary, minHeight = 52.dp)
            }
            else -> {
                Title("كيف بدك تشوف النتائج؟")
                for ((value, name, desc) in listOf(Triple(true, "مبتدئ", "النتيجة والإجراء المقترح فقط"), Triple(false, "خبير", "كل الأرقام والمسارات والأدوات"))) {
                    val on = simple == value
                    Column(
                        Modifier.fillMaxWidth().background(if (on) Jard.colors.surfaceSelected else Color.Transparent)
                            .border(BorderStroke(1.dp, if (on) Jard.colors.accent else Jard.colors.lineStrong))
                            .clickable(role = Role.RadioButton) { simple = value }.padding(12.dp),
                    ) {
                        T(name, weight = FontWeight.Bold)
                        Muted(desc)
                    }
                }
                Muted("تقدر تغيّر هذا لاحقاً من الإعدادات.")
                Btn("ابدأ الفحص الأول", {
                    s.finishOnboarding(simple)
                    s.page = Page.None
                    s.startScan()
                }, Modifier.fillMaxWidth(), BtnKind.Primary, minHeight = 52.dp)
                Btn("لاحقاً", {
                    s.finishOnboarding(simple)
                    s.page = Page.None
                }, Modifier.fillMaxWidth())
            }
        }
    }
}

@Composable
private fun PermissionCard(name: String, why: String, granted: Boolean, ask: () -> Unit) {
    Card(borderColor = if (granted) Jard.colors.statusGood else Jard.colors.line) {
        T(name, weight = FontWeight.Bold)
        Muted(why)
        if (granted) T("تم السماح", color = Jard.colors.statusGood, weight = FontWeight.SemiBold)
        else Btn("سماح", ask, Modifier.fillMaxWidth())
    }
}

/** Guests see this everywhere: it's the customer's phone, and leaving must stay one tap away. */
@Composable
fun GuestBanner(s: AppState) {
    if (!s.guest) return
    Note("وضع ضيف: ما في شي بينحفظ.", Jard.colors.statusWarn, "خروج ومسح") { s.leaveGuest() }
}

/** The beginner's home: one sentence on how the phone is, and four ways to go. */
@Composable
fun SimpleHome(s: AppState) {
    val tree = s.tree
    val storage = s.storage
    val percent = if (storage.total > 0) storage.used * 100 / storage.total else 0
    val biggest = remember(tree, s.version) {
        tree?.let { t -> kindTotals(t).firstOrNull { it.first != FileKind.Other }?.first?.label }
    }
    Page {
        GuestBanner(s)
        T(
            when {
                percent >= 90 -> "المساحة قربت تخلص"
                percent >= 75 -> "هاتفك بخير، بس المساحة بدها انتباه"
                else -> "هاتفك فيه مساحة كافية"
            },
            style = JardType.title.copy(fontSize = 32.sp),
        )
        T(
            when {
                biggest != null -> "باقي عندك ${ltr(sizeText(storage.free))}. أكبر شي عندك: ${I18n.tr(biggest)}."
                else -> "باقي عندك ${ltr(sizeText(storage.free))}. افحص لتعرف وين راحت المساحة."
            },
            color = Jard.colors.inkQuiet,
        )
        if (s.scanError != null) Note(s.scanError!!, Jard.colors.statusSerious)
        BigAction("نظّف الهاتف", "نقترح عليك ملفات، وأنت تختار", primary = true) { if (s.tree == null) s.startScan() else s.page = Page.Clean }
        BigAction("ليش هاتفي بطيء؟", "نفحص ونشرح السبب بكلام بسيط") { s.page = Page.Slow }
        BigAction("هل في شي يقلق؟", "تطبيقات مخفية وصلاحيات حساسة") { s.page = Page.Security }
        BigAction("بدي أشتري أو أبيع هاتف", "تقرير حالة تقدر تشاركه") { s.page = Page.Used }
        Btn("التبديل إلى وضع الخبير", { s.setSimpleMode(false) }, Modifier.fillMaxWidth())
    }
}

@Composable
private fun BigAction(title: String, note: String, primary: Boolean = false, onClick: () -> Unit) {
    val c = Jard.colors
    Column(
        Modifier.fillMaxWidth().background(if (primary) c.accent else c.surfaceRaised)
            .border(BorderStroke(1.dp, if (primary) c.accent else c.line))
            .clickable(role = Role.Button, onClick = onClick).padding(16.dp),
    ) {
        T(title, style = JardType.heading.copy(fontSize = 20.sp), color = if (primary) c.accentOn else c.ink, weight = FontWeight.Bold)
        T(note, color = if (primary) c.accentOn else c.inkQuiet)
    }
}

/** What can go, picked by the person. When nothing's worth removing, it says that and offers other ways. */
@Composable
fun CleanScreen(s: AppState) {
    val tree = s.tree
    if (tree == null) {
        Page {
            Head(s, "نظّف الهاتف")
            T("لسا ما فحصت.", color = Jard.colors.inkQuiet)
            Btn("ابدأ الفحص", { s.startScan() }, kind = BtnKind.Primary)
        }
        return
    }
    val items = remember(tree, s.version) { Suggestions.of(tree) }
    val checked = remember(tree, s.version) { mutableStateMapOf<Int, FileNode>() }
    var failure by remember { mutableStateOf<String?>(null) }
    if (items.isEmpty()) {
        NothingToClean(s, tree)
        return
    }
    Page {
        Head(s, "نظّف الهاتف", "ما تختاره ينتقل إلى الحجر المؤقت 30 يوماً، وتقدر تسترجعه.")
        failure?.let { Note(it, Jard.colors.statusSerious, "حسناً") { failure = null } }
        if (s.guest) Muted("وضع ضيف: التصفح فقط. ما منحرّك شي على هاتف الزبون.")
        for (it in items) {
            CheckRow(checked.containsKey(it.node.id), { on -> if (on) checked[it.node.id] = it.node else checked.remove(it.node.id) }, it.node.name, enabled = !s.guest) {
                Column(Modifier.weight(1f)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        T(it.node.name, Modifier.weight(1f), weight = FontWeight.SemiBold)
                        Num(sizeText(it.node.onDisk))
                    }
                    Muted(it.why)
                }
            }
        }
        if (checked.isNotEmpty()) {
            Btn("نقل ${checked.size} إلى الحجر", {
                val done = ArrayList<Pair<QuarantineItem, Int>>()
                var bytes = 0L
                var problem: String? = null
                for (n in checked.values.toList()) {
                    when (val r = s.store.move(tree, n)) {
                        is MoveResult.Moved -> {
                            tree.detach(n.id)
                            done.add(r.item to n.id)
                            bytes += n.onDisk
                        }
                        is MoveResult.Failed -> problem = "${n.name}: ${r.why}"
                    }
                }
                checked.clear()
                s.version++
                s.saveLater()
                failure = problem
                if (done.isNotEmpty()) {
                    s.movedBytes = bytes
                    s.movedCount = done.size
                    s.pendingUndo = done
                    s.page = Page.Result
                }
            }, Modifier.fillMaxWidth(), BtnKind.Primary, minHeight = 52.dp)
        }
        Muted("ما بنحدد شي عنك.")
    }
}

@Composable
private fun NothingToClean(s: AppState, tree: app.jard.engine.ScanTree) {
    val kinds = remember(tree, s.version) { kindTotals(tree) }
    val video = kinds.firstOrNull { it.first == FileKind.Video }?.second ?: 0
    val photos = kinds.firstOrNull { it.first == FileKind.Image }?.second ?: 0
    Page {
        Head(s, "جهازك نظيف فعلاً")
        T("ما لقينا ملفات تثبيت قديمة ولا سلة مهملات ولا شي قديم يستاهل الحذف. المساحة رايحة على أشياء تستخدمها.", color = Jard.colors.inkQuiet)
        T("وين رايحة المساحة", weight = FontWeight.Bold)
        Card {
            for ((k, v) in kinds.take(4)) FactRow(k.label, sizeText(v))
        }
        T("خيارات غير الحذف", weight = FontWeight.Bold)
        if (video > 0) Card {
            T("انقل الفيديو لبطاقة الذاكرة أو كمبيوتر", weight = FontWeight.SemiBold)
            Muted("يفضي مساحة داخلية بحجم ${ltr(sizeText(video))}.")
        }
        if (photos > 0) Card {
            T("ارفع الصور القديمة لخدمة سحابية", weight = FontWeight.SemiBold)
            Muted("تأخذ ${ltr(sizeText(photos))} هون. يحتاج إنترنت، من تطبيق غير جرد.")
        }
        Muted("ما بنقترح حذف شي تستخدمه. لو ضليت ضيّق، شوف أكبر التطبيقات.")
        Btn("شوف أكبر التطبيقات", { s.page = Page.None; s.tab = Tab.Apps }, Modifier.fillMaxWidth())
        Btn("كشف المكررات", { s.page = Page.None; s.tab = Tab.Files }, Modifier.fillMaxWidth())
    }
}

/** What moved, and the honest part: space comes back after 30 days or when quarantine is emptied. */
@Composable
fun ResultScreen(s: AppState) {
    val storage = s.storage
    Page {
        Muted("خرج من مكانه")
        Num(sizeText(s.movedBytes), size = 44, color = Jard.colors.accent)
        T("انتقل ${s.movedCount} عنصر إلى الحجر المؤقت.", weight = FontWeight.SemiBold)
        T("المساحة ما بتتحرر قبل انتهاء الـ 30 يوماً أو تفريغ الحجر: هذا اللي بيخليك تسترجعها.", color = Jard.colors.inkQuiet)
        Card {
            FactRow("المستخدم الآن", "${sizeText(storage.used)} / ${sizeText(storage.total)}")
            FactRow("بعد تفريغ الحجر", "${sizeText((storage.used - s.movedBytes).coerceAtLeast(0))} / ${sizeText(storage.total)}")
        }
        if (s.pendingUndo.isNotEmpty()) {
            Btn("تراجع", {
                val tree = s.tree
                for ((item, id) in s.pendingUndo) if (s.store.restore(item) == null) tree?.reattach(id)
                s.pendingUndo = emptyList()
                s.version++
                s.saveLater()
                s.page = Page.None
            }, Modifier.fillMaxWidth())
        }
        Btn("فتح الحجر", { s.pendingUndo = emptyList(); s.page = Page.History }, Modifier.fillMaxWidth())
        Btn("تم", { s.pendingUndo = emptyList(); s.page = Page.None }, Modifier.fillMaxWidth(), BtnKind.Primary)
    }
}

@Composable
fun ExplainScreen(s: AppState) {
    val n = s.explaining
    val tree = s.tree
    if (n == null || tree == null) {
        s.goBack()
        return
    }
    val e = remember(n) { Explain.of(n) }
    val reason = remember(n) { protectedReason(tree, n) }
    Page {
        Head(s, "شو هذا؟")
        T(n.name, style = JardType.title.copy(fontSize = 22.sp))
        Num(sizeText(n.onDisk), size = 18)
        T(e.safety.word, weight = FontWeight.Bold, color = when (e.safety) {
            Safety.Safe, Safety.Mostly -> Jard.colors.statusGood
            Safety.Keep -> Jard.colors.statusSerious
            else -> Jard.colors.statusWarn
        })
        Card {
            T("شو هذا؟", weight = FontWeight.Bold)
            T(e.what, color = Jard.colors.inkQuiet)
        }
        Card {
            T("شو بصير لو حذفته؟", weight = FontWeight.Bold)
            T(e.ifDeleted, color = Jard.colors.inkQuiet)
        }
        if (reason != null) Muted(reason)
        if (reason == null && !s.guest) {
            var problem by remember { mutableStateOf<String?>(null) }
            problem?.let { Note(it, Jard.colors.statusSerious) }
            Btn("نقل إلى الحجر", {
                when (val r = s.store.move(tree, n)) {
                    is MoveResult.Moved -> {
                        tree.detach(n.id)
                        s.movedBytes = n.onDisk
                        s.movedCount = 1
                        s.pendingUndo = listOf(r.item to n.id)
                        s.version++
                        s.saveLater()
                        s.page = Page.Result
                    }
                    is MoveResult.Failed -> problem = r.why
                }
            }, Modifier.fillMaxWidth())
        }
    }
}

/** Android/data and friends, on the Files screen: locked with a reason, and open once allowed. */
@Composable
fun LockedFolders(s: AppState) {
    val context = LocalContext.current
    val level = remember(s.rootOn, s.version) { Privileged.level(context) }
    val paths = buildList {
        if (android.os.Build.VERSION.SDK_INT >= 30) add("Android/data" to "بيانات التطبيقات")
        add("/data/data" to "الملفات الخاصة")
        add("/system" to "ملفات النظام")
    }
    T(if (level == app.jard.engine.Access.Normal) "تحتاج صلاحية إضافية" else "بالصلاحية المفعّلة", style = JardType.label, color = Jard.colors.statusSerious)
    for ((path, note) in paths) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 46.dp).background(Jard.colors.surfaceRaised).clickable(role = Role.Button) { s.page = Page.Access }.padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            PathIcon("M12.6 10H22v4h-2v3h-4v-3h-3.4A5 5 0 1 1 12.6 10zM7 10.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 1 0 0-3.2z", Jard.colors.statusSerious, 14)
            Box(Modifier.weight(1f)) { Num(path) }
            Muted(note)
        }
    }
}

/** The permission went during a scan, or the system closed the app. Says what's left, and what to do. */
@Composable
fun ScanLostScreen(s: AppState, resumed: Int) {
    val has = remember(resumed) { s.canScan }
    val interrupted = s.scanInterrupted
    val kept = !interrupted && s.tree?.partial == true
    Page {
        Title(if (interrupted) "انقطع الفحص الأخير" else "انسحبت الصلاحية أثناء الفحص")
        T(
            if (interrupted) "وقف النظام التطبيق أثناء الفحص، أو انسحبت صلاحية الملفات. يصير هذا من إعدادات النظام، أو لما يحتاج الهاتف ذاكرة."
            else "توقف الفحص عند ${s.lostPercent}%. يصير هذا لما تُلغى الصلاحية من إعدادات النظام.",
            color = Jard.colors.inkQuiet,
        )
        Card {
            T("المحفوظ حتى الآن", weight = FontWeight.Bold)
            T(
                if (kept) "نتائج ${app.jard.engine.countText(s.lostFiles)} ملف. نعرضها معلّمة كغير مكتملة ولا نحذفها."
                else "ما انحفظ شي من هذا الفحص. نتيجة الفحص الكامل السابق، إذا في، بتضل مكانها.",
                color = Jard.colors.inkQuiet,
            )
        }
        if (has) {
            Btn("فحص من جديد", { s.page = Page.None; s.startScan() }, Modifier.fillMaxWidth(), BtnKind.Primary, minHeight = 52.dp)
        } else {
            Btn("إعادة السماح", { s.page = Page.Permission }, Modifier.fillMaxWidth(), BtnKind.Primary, minHeight = 52.dp)
        }
        if (kept) Btn("عرض النتائج الجزئية", { s.page = Page.None; s.tab = Tab.Files }, Modifier.fillMaxWidth())
        else Btn("رجوع", { s.page = Page.None }, Modifier.fillMaxWidth())
    }
}
