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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.jard.design.Jard
import app.jard.design.JardData
import app.jard.design.JardRow
import app.jard.design.JardSpace
import app.jard.design.JardType
import app.jard.engine.Device
import app.jard.engine.DuplicateCopy
import app.jard.engine.Duplicates
import app.jard.engine.FileKind
import app.jard.engine.FileNode
import app.jard.engine.FileSort
import app.jard.engine.MoveResult
import app.jard.engine.QuarantineItem
import app.jard.engine.agoText
import app.jard.engine.countText
import app.jard.engine.kindTotals
import app.jard.engine.protectedReason
import app.jard.engine.sizeText
import kotlinx.coroutines.delay
import kotlin.concurrent.thread

@Composable
private fun Page(content: @Composable () -> Unit) {
    // Scrolls rather than clips, so large system fonts never cut anything off.
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) { content() }
}

/* ---------- home ---------- */

@Composable
fun HomeScreen(s: AppState, resumed: Int) {
    val tree = s.tree
    val used = s.storage.used
    val version = s.version
    val layers = remember(tree, version, resumed) {
        val out = ArrayList<Triple<String, Long, Color>>()
        val appsTotal = s.apps?.sumOf { it.total }
        if (appsTotal != null && appsTotal > 0) out.add(Triple("التطبيقات", appsTotal, JardData.d1))
        if (tree != null) {
            val colors = mapOf(FileKind.Video to JardData.d2, FileKind.Image to JardData.pale, FileKind.Audio to JardData.d4, FileKind.Document to JardData.d5, FileKind.Archive to JardData.d3)
            for ((k, v) in kindTotals(tree)) if (k != FileKind.Other) out.add(Triple(k.label, v, colors[k] ?: JardData.grey))
        }
        val known = out.sumOf { it.second }
        if (used > known && (appsTotal != null || tree != null)) out.add(Triple("النظام وأخرى", used - known, JardData.grey))
        out.sortByDescending { it.second }
        out
    }
    Page {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(Modifier.width(24.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Box(Modifier.fillMaxWidth().height(5.dp).background(JardData.d1))
                Box(Modifier.fillMaxWidth(0.7f).height(5.dp).background(JardData.d2))
                Box(Modifier.fillMaxWidth(0.4f).height(5.dp).background(JardData.d3))
            }
            T("جَرد", style = JardType.title.copy(fontSize = 20.sp))
        }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
            Column(Modifier.weight(1f)) {
                T("المساحة المستخدمة", color = Jard.colors.inkMuted, weight = FontWeight.Medium)
                Num(sizeText(used), size = 30)
                Num("/ ${sizeText(s.storage.total)}", color = Jard.colors.inkMuted)
            }
            Btn("فحص جديد", { s.startScan() }, kind = BtnKind.Primary, minHeight = 48.dp)
        }
        if (s.scanError != null) Note(s.scanError!!, Jard.colors.statusSerious)
        if (tree == null && layers.isEmpty()) {
            T("افحص جهازك لتعرف أين ذهبت المساحة. نقرأ أسماء الملفات وأحجامها فقط، والتطبيق ما عنده صلاحية إنترنت أصلاً.", color = Jard.colors.inkQuiet)
        }
        if (tree?.partial == true) Note("الفحص الأخير لم يكتمل، فالأرقام أقل من الحقيقة.", Jard.colors.statusWarn, "أعد الفحص") { s.startScan() }
        if (tree != null && tree.scope == app.jard.engine.ScanTree.Scope.Picked) {
            Note("هذا فحص جزئي: المجموع ${ltr(sizeText(tree.root.onDisk))} من مجلداتك المختارة فقط، من أصل ${ltr(sizeText(used))} مستخدمة.", Jard.colors.statusWarn)
        }
        for ((name, size, color) in layers) {
            Row(
                Modifier.fillMaxWidth().heightIn(min = JardRow.withBar).clickable {
                    s.tab = if (name == "التطبيقات") Tab.Apps else Tab.Files
                },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Box(Modifier.width(72.dp).height((16 + (40f * size / used.coerceAtLeast(1))).dp).background(color))
                T(name, Modifier.weight(1f), weight = FontWeight.Medium)
                Num(sizeText(size))
            }
        }
        if (layers.isNotEmpty()) {
            Row(Modifier.fillMaxWidth().heightIn(min = JardRow.simple), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.width(72.dp).height(20.dp).border(BorderStroke(1.dp, Jard.colors.lineStrong)))
                T("متاح", Modifier.weight(1f), weight = FontWeight.Medium)
                Num(sizeText(s.storage.free))
            }
        }
        if (s.apps == null) Muted("لعرض حجم التطبيقات، فعّل الوصول من تبويب التطبيقات.")
    }
}

/* ---------- permission ---------- */

@Composable
fun PermissionScreen(s: AppState, resumed: Int) {
    val context = LocalContext.current
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri -> if (uri != null) s.addPicked(uri) }
    var asked by remember { mutableStateOf(0) }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { asked++ }
    val has = remember(resumed, asked) { Device.hasAllFiles(context) }
    LaunchedEffect(has) { if (has) s.page = Page.None }
    Page {
        Title("ليش نحتاج الوصول لكل الملفات؟")
        T("لنحسب حجم كل مجلد، لازم نقرأ أسماء وأحجام الملفات. لا نفتح محتوى أي ملف، ولا نرسل شيئاً للإنترنت.", color = Jard.colors.inkQuiet)
        for ((k, v) in listOf("نقرأ" to "أسماء الملفات وأحجامها وتواريخها فقط.", "ما نقرأ" to "محتوى الصور والرسائل والمستندات، إلا لو طلبت كشف المكررات.", "ما نرسل" to "ولا بايت. التطبيق ما عنده صلاحية إنترنت أصلاً.")) {
            Card {
                T(k, weight = FontWeight.SemiBold)
                Muted(v)
            }
        }
        Btn("السماح بكل الملفات", {
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                context.startActivity(Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:${context.packageName}")))
            } else {
                ask.launch(Device.LEGACY_STORAGE)
            }
        }, Modifier.fillMaxWidth(), BtnKind.Primary, minHeight = 52.dp)
        T("أو اختر مجلدات محددة", weight = FontWeight.SemiBold)
        Muted("الخطة البديلة إذا ما بدك تعطي الصلاحية الكاملة. الفحص يصير جزئياً، وبنقول هذا بوضوح.")
        for (uri in s.picked) {
            Row(Modifier.fillMaxWidth().background(Jard.colors.surfaceRaised).padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Num(uri.lastPathSegment?.substringAfterLast(':').orEmpty().ifEmpty { "/" }, Modifier.weight(1f))
                Btn("إزالة", { s.removePicked(uri) })
            }
        }
        Btn("إضافة مجلد", { pick.launch(null) }, Modifier.fillMaxWidth())
        if (s.picked.isNotEmpty()) Btn("فحص المجلدات المختارة", { s.startScan() }, Modifier.fillMaxWidth(), BtnKind.Primary)
        Btn("رجوع", { s.page = Page.None }, Modifier.fillMaxWidth())
    }
}

/* ---------- scan ---------- */

@Composable
fun ScanScreen(s: AppState) {
    var tick by remember { mutableStateOf(0) }
    LaunchedEffect(s.scanning) {
        while (s.scanning) {
            delay(200)
            tick++
        }
        if (!s.scanning) s.page = Page.None
    }
    val p = s.progress
    @Suppress("UNUSED_VARIABLE") val redraw = tick
    val used = s.storage.used.coerceAtLeast(1)
    val whole = Device.hasAllFiles(LocalContext.current)
    val pct = (p.bytes.get() * 100 / used).coerceAtMost(99).toInt()
    Page {
        Title("جارٍ الفحص")
        Muted(if (whole) "التخزين الداخلي" else "المجلدات المختارة")
        if (whole) {
            Num("$pct%", size = 72)
            ShareBar(pct / 100f, JardData.d2, height = 20.dp)
        } else {
            Num(sizeText(p.bytes.get()), size = 44)
        }
        Num(p.current, size = 12, color = Jard.colors.inkQuiet)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Card(Modifier.weight(1f)) {
                Muted("ملفات")
                Num(countText(p.files.get()), size = 18)
            }
            Card(Modifier.weight(1f)) {
                Muted("حجم")
                Num(sizeText(p.bytes.get()), size = 18)
            }
        }
        Btn("إيقاف وعرض النتائج", { p.cancelled.set(true) }, Modifier.fillMaxWidth(), minHeight = 52.dp)
        Muted("الأرقام أثناء الفحص تقريبية.")
    }
}

/* ---------- files ---------- */

@Composable
fun FilesScreen(s: AppState) {
    val tree = s.tree
    val context = LocalContext.current
    if (tree == null) {
        Page {
            Title("الملفات")
            T("لسا ما فحصت. الفحص يبين كل مجلد بحجمه.", color = Jard.colors.inkQuiet)
            Btn("ابدأ الفحص", { s.startScan() }, kind = BtnKind.Primary)
        }
        return
    }
    var folder by remember(tree) { mutableStateOf(0) }
    var mode by remember { mutableStateOf("largest") }
    val checked = remember(tree, folder, s.version) { mutableStateMapOf<Int, FileNode>() }
    var undo by remember { mutableStateOf<List<Pair<QuarantineItem, Int>>>(emptyList()) }
    var failure by remember { mutableStateOf<String?>(null) }
    var dupes by remember(tree, s.version) { mutableStateOf<List<DuplicateCopy>?>(null) }
    var busy by remember { mutableStateOf(false) }
    val version = s.version
    val rows = remember(tree, folder, mode, version, dupes) {
        when (mode) {
            "oldest" -> tree.children(folder, FileSort.Oldest)
            "dupes" -> dupes.orEmpty().map { it.node }
            else -> tree.children(folder, FileSort.Largest)
        }
    }
    val parent = tree.nodes[folder]
    val whole = (if (mode == "dupes") rows.sumOf { it.onDisk } else parent.onDisk).coerceAtLeast(1)

    fun moveChecked() {
        val done = ArrayList<Pair<QuarantineItem, Int>>()
        val failed = ArrayList<String>()
        for (n in checked.values.toList()) {
            when (val r = s.store.move(tree, n)) {
                is MoveResult.Moved -> {
                    tree.detach(n.id)
                    done.add(r.item to n.id)
                }
                is MoveResult.Failed -> failed.add("${n.name}: ${r.why}")
            }
        }
        checked.clear()
        undo = done
        failure = failed.firstOrNull()?.let { if (failed.size > 1) "$it (+${failed.size - 1})" else it }
        s.version++
    }

    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(Modifier.weight(1f)) {
                Title(if (folder == 0) "الملفات" else parent.name)
                Num(if (parent.location.startsWith("content://")) parent.name else parent.location, size = 12, color = Jard.colors.inkMuted)
            }
            if (folder != 0) Btn("أعلى", { folder = parent.parent })
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            for ((id, name) in listOf("largest" to "الأكبر", "oldest" to "الأقدم", "dupes" to "المكرر")) {
                val on = id == mode
                Box(
                    Modifier.weight(1f).heightIn(min = JardSpace.touchMin)
                        .background(if (on) Jard.colors.surfaceSelected else Color.Transparent)
                        .border(BorderStroke(1.dp, if (on) Jard.colors.accent else Jard.colors.line))
                        .clickable(role = Role.RadioButton) { mode = id },
                    contentAlignment = Alignment.Center,
                ) { T(name, weight = if (on) FontWeight.SemiBold else FontWeight.Normal) }
            }
        }
        if (mode == "dupes" && dupes == null) {
            Muted("يقرأ محتوى الملفات المتشابهة في الحجم ليقارنها، فممكن ياخد وقت.")
            Btn(if (busy) "يقارن…" else "ابحث عن المكررات", {
                busy = true
                thread {
                    val found = Duplicates.find(context, tree) { false }
                    dupes = found
                    busy = false
                }
            }, Modifier.fillMaxWidth(), enabled = !busy)
        }
        if (mode == "dupes" && dupes?.isEmpty() == true) T("ما في ملفات مكررة أكبر من 1 MB.", color = Jard.colors.inkQuiet)
        if (undo.isNotEmpty()) {
            Note("انتقل ${undo.size} إلى الحجر المؤقت ويبقى 30 يوماً.", Jard.colors.statusGood, "تراجع") {
                for ((item, id) in undo) if (s.store.restore(item) == null) tree.reattach(id)
                undo = emptyList()
                s.version++
            }
        }
        failure?.let { Note(it, Jard.colors.statusSerious, "حسناً") { failure = null } }
        if (mode != "dupes" && rows.isEmpty()) T(if (parent.denied) "ما سمح النظام بقراءة هذا المجلد." else "هذا المجلد فارغ.", color = Jard.colors.inkQuiet)
        LazyColumn(Modifier.weight(1f)) {
            items(rows, key = { it.id }) { n ->
                val reason = protectedReason(tree, n)
                val keep = dupes?.firstOrNull { it.node.id == n.id }?.keepPath?.takeIf { mode == "dupes" }
                Row(
                    Modifier.fillMaxWidth().heightIn(min = JardRow.withBar),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    CheckRow(checked.containsKey(n.id), { on -> if (on) checked[n.id] = n else checked.remove(n.id) }, if (reason != null) "${n.name}: $reason" else "تحديد ${n.name}", Modifier.width(36.dp), enabled = reason == null) {}
                    Column(
                        Modifier.weight(1f).heightIn(min = JardSpace.touchMin)
                            .then(if (n.isDir && n.children.isNotEmpty() && mode != "dupes") Modifier.clickable(role = Role.Button) { folder = n.id } else Modifier)
                            .semantics { contentDescription = "${n.name}، ${if (n.isDir) "مجلد" else "ملف"}، ${sizeText(n.onDisk)}" },
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            T(n.name + if (n.isDir) "/" else "", Modifier.weight(1f), weight = FontWeight.Medium)
                            if (n.partial) T("جزئي", style = JardType.label, color = Jard.colors.statusWarn)
                            if (n.denied) T("تعذّرت القراءة", style = JardType.label, color = Jard.colors.statusWarn)
                            if (n.isLink) T("اختصار", style = JardType.label, color = Jard.colors.inkMuted)
                            Num(sizeText(n.onDisk))
                        }
                        ShareBar(n.onDisk.toFloat() / whole, if (n.isDir) JardData.d2 else JardData.d4)
                        when {
                            keep != null -> Muted("نسخة من: ${ltr(keep)}")
                            mode == "oldest" && !n.isDir -> Muted(agoText(n.modified))
                        }
                    }
                }
            }
        }
        if (checked.isNotEmpty()) {
            Row(
                Modifier.fillMaxWidth().background(Jard.colors.surfaceSelected).border(BorderStroke(1.dp, Jard.colors.accent)).padding(8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Column(Modifier.weight(1f)) {
                    T("تم تحديد ${checked.size}", weight = FontWeight.SemiBold)
                    Num(sizeText(checked.values.sumOf { it.onDisk }))
                }
                Btn("نقل إلى الحجر", { moveChecked() }, kind = BtnKind.Primary)
            }
        }
        if (s.tree?.scope == app.jard.engine.ScanTree.Scope.AllFiles) {
            // Android 11 closed Android/data to other apps; on 10 and older the scan reads it.
            Muted(if (android.os.Build.VERSION.SDK_INT >= 30) "${ltr("Android/data")} و${ltr("/data")} يحتاجان روت أو Shizuku، فما دخلوا في هذا الفحص." else "${ltr("/data")} يحتاج روت، فما دخل في هذا الفحص.")
        }
    }
}

/* ---------- apps ---------- */

@Composable
fun AppsScreen(s: AppState, resumed: Int) {
    val context = LocalContext.current
    val hasAccess = remember(resumed) { Device.hasUsageAccess(context) }
    LaunchedEffect(hasAccess) { if (hasAccess && s.apps == null) s.refreshApps() }
    var open by remember { mutableStateOf<String?>(null) }
    val apps = s.apps
    if (!hasAccess) {
        Page {
            Title("التطبيقات")
            T("حتى نعرف حجم كل تطبيق، يحتاج أندرويد إذن «الوصول إلى الاستخدام». نستخدمه لقراءة الأحجام فقط.", color = Jard.colors.inkQuiet)
            Btn("فتح إعدادات الإذن", { context.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)) }, Modifier.fillMaxWidth(), BtnKind.Primary)
        }
        return
    }
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) { Title("التطبيقات") }
            if (apps != null) Muted("${apps.size} تطبيق · ${ltr(sizeText(apps.sumOf { it.total }))}")
        }
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            for ((n, c) in listOf("التطبيق" to JardData.d1, "البيانات" to JardData.d2, "الكاش" to JardData.pale)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    Swatch(c)
                    T(n, style = JardType.label, color = Jard.colors.inkQuiet)
                }
            }
        }
        if (apps == null) {
            Muted("يقرأ الأحجام…")
            return@Column
        }
        val max = (apps.firstOrNull()?.total ?: 1L).coerceAtLeast(1)
        LazyColumn(Modifier.weight(1f)) {
            items(apps, key = { it.pkg }) { a ->
                Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                    Column(
                        Modifier.fillMaxWidth().heightIn(min = JardRow.withBar).clickable(role = Role.Button) { open = if (open == a.pkg) null else a.pkg },
                        verticalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterVertically),
                    ) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            T(a.name, Modifier.weight(1f), weight = FontWeight.Medium)
                            Num(sizeText(a.total))
                        }
                        Row(Modifier.fillMaxWidth((a.total.toFloat() / max).coerceIn(0.01f, 1f)).height(5.dp), horizontalArrangement = Arrangement.spacedBy(1.dp)) {
                            if (a.app > 0) Box(Modifier.weight(a.app.toFloat()).height(5.dp).background(JardData.d1))
                            if (a.data > 0) Box(Modifier.weight(a.data.toFloat()).height(5.dp).background(JardData.d2))
                            if (a.cache > 0) Box(Modifier.weight(a.cache.toFloat()).height(5.dp).background(JardData.pale))
                        }
                    }
                    if (open == a.pkg) {
                        Muted("التطبيق ${ltr(sizeText(a.app))} · البيانات ${ltr(sizeText(a.data))} · الكاش ${ltr(sizeText(a.cache))}")
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(vertical = 6.dp)) {
                            Btn("مسح الكاش من الإعدادات", {
                                context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${a.pkg}")))
                            }, Modifier.weight(1f))
                            if (!a.system) Btn("إلغاء التثبيت", {
                                context.startActivity(Intent(Intent.ACTION_DELETE, Uri.parse("package:${a.pkg}")))
                            }, Modifier.weight(1f))
                        }
                        Muted("بدون روت، أندرويد ما بيسمح لتطبيق يمسح كاش تطبيق تاني، فنفتح لك صفحته بالإعدادات.")
                    }
                }
            }
        }
    }
}

/* ---------- device check ---------- */

@Composable
fun CheckScreen(s: AppState) {
    val context = LocalContext.current
    val info = remember(s.version) { Device.info(context) }
    Page {
        Title("فحص الجهاز")
        Muted("قراءات من النظام كما هي، بدون درجة مخترعة.")
        Card {
            T("الجهاز", weight = FontWeight.SemiBold)
            Fact("الموديل", info.model)
            Fact("أندرويد", info.android)
            Fact("تحديث الأمان", info.securityPatch)
            Fact("المعالج", info.cpu)
        }
        Card {
            T("الذاكرة", weight = FontWeight.SemiBold)
            Fact("المستخدم", "${sizeText(info.ramTotal - info.ramFree)} / ${sizeText(info.ramTotal)}")
            ShareBar((info.ramTotal - info.ramFree).toFloat() / info.ramTotal.coerceAtLeast(1), JardData.d2, height = 5.dp)
        }
        Card {
            T("البطارية", weight = FontWeight.SemiBold)
            Fact("الشحن", if (info.batteryPercent >= 0) "${info.batteryPercent}%${if (info.batteryCharging) " · يشحن" else ""}" else "—")
            Fact("الحرارة", "${info.batteryTemp}°C")
            T("الحالة: ${info.batteryHealth}", color = Jard.colors.inkQuiet)
        }
        Card {
            T("الأمان", weight = FontWeight.SemiBold)
            T(if (info.screenLock) "قفل الشاشة مفعّل." else "ما في قفل شاشة: أي حدا بيقدر يفتح جهازك.", color = if (info.screenLock) Jard.colors.statusGood else Jard.colors.statusSerious)
            T(if (info.devOptions) "خيارات المطور مفعّلة. إذا ما بتستخدمها، أوقفها." else "خيارات المطور مغلقة.", color = if (info.devOptions) Jard.colors.statusWarn else Jard.colors.statusGood)
        }
    }
}

@Composable
private fun Fact(k: String, v: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Muted(k, Modifier.weight(1f))
        Num(v)
    }
}

/* ---------- more ---------- */

@Composable
fun MoreScreen(s: AppState) {
    Page {
        Title("المزيد")
        for ((name, page) in listOf("السجل والحجر" to Page.History, "الوصول إلى الملفات" to Page.Permission, "الإعدادات" to Page.Settings, "لسا ما انبنى" to Page.Tools, "حول جَرد" to Page.About)) {
            Row(
                Modifier.fillMaxWidth().heightIn(min = JardSpace.touchMin).clickable(role = Role.Button) { s.page = page }.padding(vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) { T(name, Modifier.weight(1f), weight = FontWeight.Medium) }
            Box(Modifier.fillMaxWidth().height(1.dp).background(Jard.colors.line))
        }
    }
}

@Composable
fun HistoryScreen(s: AppState) {
    val store = s.store
    var version by remember { mutableStateOf(0) }
    val items = remember(version, s.version) { store.list() }
    val log = remember(version, s.version) { store.history() }
    var message by remember { mutableStateOf<String?>(null) }
    val confirming = remember { mutableStateListOf<String>() }
    Page {
        Title("السجل")
        message?.let { Note(it, Jard.colors.statusSerious, "حسناً") { message = null } }
        T("الحجر المؤقت · ${ltr(sizeText(items.sumOf { it.onDisk }))}", weight = FontWeight.SemiBold)
        if (items.isEmpty()) Muted("الحجر فارغ. اللي تنقله من الملفات بيضل هون 30 يوماً وتقدر تسترجعه.")
        for (i in items) {
            Card {
                T(i.name, weight = FontWeight.Medium)
                Num(sizeText(i.onDisk))
                Muted("يُحذف بعد ${i.daysLeft()} يوماً")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Btn("استرجاع", {
                        message = store.restore(i)
                        // The numbers on screen predate the file coming back: only a new scan is exact.
                        version++
                    }, Modifier.weight(1f))
                    if (i.id in confirming) {
                        Btn("تأكيد الحذف", {
                            message = store.delete(i)
                            s.refreshStorage()
                            version++
                        }, Modifier.weight(1f), BtnKind.Danger)
                    } else {
                        Btn("حذف نهائي", { confirming.add(i.id) }, Modifier.weight(1f))
                    }
                }
                if (i.id in confirming) Muted("ما بنقدر نسترجعه بعدها.")
            }
        }
        T("آخر العمليات", weight = FontWeight.SemiBold)
        if (log.isEmpty()) Muted("ما في عمليات بعد.")
        for ((at, what, bytes) in log) {
            Column {
                T(what)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Num(sizeText(bytes), color = Jard.colors.inkMuted)
                    Muted(agoText(at))
                }
            }
        }
    }
}

@Composable
fun SettingsScreen(s: AppState) {
    Page {
        Title("الإعدادات")
        T("المظهر", weight = FontWeight.SemiBold)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            for ((name, value) in listOf("داكن" to true, "فاتح" to false, "حسب النظام" to null)) {
                val on = s.dark == value
                Box(
                    Modifier.weight(1f).heightIn(min = JardSpace.touchMin)
                        .background(if (on) Jard.colors.surfaceSelected else Color.Transparent)
                        .border(BorderStroke(1.dp, if (on) Jard.colors.accent else Jard.colors.lineStrong))
                        .clickable(role = Role.RadioButton) { s.setTheme(value) },
                    contentAlignment = Alignment.Center,
                ) { T(name, weight = FontWeight.SemiBold) }
            }
        }
        T("الخصوصية", weight = FontWeight.SemiBold)
        T("يعمل بدون إنترنت: ما عنده صلاحية إنترنت أصلاً، فما بيقدر يرسل نتائج الفحص لأي جهة.", color = Jard.colors.inkQuiet)
    }
}

@Composable
fun AboutScreen(s: AppState) {
    val context = LocalContext.current
    val version = remember { context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "" }
    Page {
        Title("حول جَرد")
        Card {
            Fact("الإصدار", version)
            Fact("المطوّر", "Mahmoud F.M. Abuteir")
        }
        Muted("الخطوط: IBM Plex (OFL-1.1).")
        Btn("رجوع", { s.page = Page.None }, Modifier.fillMaxWidth())
    }
}

/** Says plainly what isn't here yet, rather than a button that does nothing. */
@Composable
fun ToolsScreen(s: AppState) {
    Page {
        Title("لسا ما انبنى")
        T("هذي نسخة أولى. هذه الميزات مرسومة في التصميم ولسا ما انبنت على أندرويد:", color = Jard.colors.inkQuiet)
        for (x in listOf("الروت وShizuku للوصول إلى Android/data", "وضع المبتدئ", "الأمان والشبكة", "البطارية والسرعة والشاشة", "ليش هاتفي بطيء؟", "تقرير الهاتف المستعمل ووضع المحل", "الويدجت والإشعارات", "Pro والتفعيل", "الواجهة الإنجليزية")) {
            T("• $x")
        }
        Btn("رجوع", { s.page = Page.None }, Modifier.fillMaxWidth())
    }
}
