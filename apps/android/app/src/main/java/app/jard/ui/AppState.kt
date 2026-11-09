package app.jard.ui

import android.content.Context
import android.net.Uri
import android.os.Environment
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import app.jard.engine.AppSize
import app.jard.engine.Device
import app.jard.engine.DeviceReport
import app.jard.engine.FileNode
import app.jard.engine.JardWidget
import app.jard.engine.Licensing
import app.jard.engine.ManualTests
import app.jard.engine.QuarantineItem
import app.jard.engine.QuarantineStore
import app.jard.engine.SavedScans
import app.jard.engine.ScanProgress
import app.jard.engine.ScanTree
import app.jard.engine.Scanner
import app.jard.engine.StorageTotals
import kotlin.concurrent.thread

enum class Tab { Home, Files, Apps, Check, More }

/** Screens over the tabs. */
enum class Page {
    None, Onboard, Permission, Scan, ScanLost, Result, History, Settings, About, Clean, Explain,
    Slow, Device, Battery, Bench, Pixels, Used, Security, Network, Compare, Widgets,
    Access, Root, Expert, Pro, Key, Guest, ShopLog, ShopReport, ShopSetup, ShopCompare, Test,
}

/** Where "back" leads. Anything not here goes back to the tabs. */
private val PARENT = mapOf(
    Page.Key to Page.Pro,
    Page.Root to Page.Access,
    Page.Pixels to Page.Bench,
    Page.ShopReport to Page.ShopLog,
    Page.ShopSetup to Page.ShopLog,
    Page.ShopCompare to Page.ShopLog,
    Page.Guest to Page.ShopLog,
)

class AppState(private val context: Context) {
    val store = QuarantineStore(context)
    private val prefs = context.getSharedPreferences("jard", Context.MODE_PRIVATE)

    var tab by mutableStateOf(Tab.Home)
    var page by mutableStateOf(Page.None)
    /** true dark (the default), false light, null follow the system. */
    var dark by mutableStateOf<Boolean?>(
        when (prefs.getString("theme", "dark")) {
            "light" -> false
            "system" -> null
            else -> true
        },
    )
    var simple by mutableStateOf(prefs.getBoolean("simple", false))
    /** A customer's phone in a shop: nothing is saved, and leaving wipes everything. */
    var guest by mutableStateOf(prefs.getBoolean("guest", false))
    var keepResults by mutableStateOf(prefs.getBoolean("keepResults", true))
    var shopName by mutableStateOf(prefs.getString("shopName", "").orEmpty())
    var proKey by mutableStateOf<String?>(null)
    var rootOn by mutableStateOf(prefs.getBoolean("root", false))

    /** What the Explain, Test and ShopReport pages are showing. */
    var explaining by mutableStateOf<FileNode?>(null)
    var testing by mutableStateOf("screen")
    var report by mutableStateOf<DeviceReport?>(null)
    /** What Result reports on: bytes moved aside, and how many items. */
    var movedBytes by mutableStateOf(0L)
    var movedCount by mutableIntStateOf(0)
    var pendingUndo by mutableStateOf<List<Pair<QuarantineItem, Int>>>(emptyList())

    val onboarded: Boolean get() = prefs.getBoolean("onboarded", false)

    fun finishOnboarding(simpleMode: Boolean) {
        prefs.edit().putBoolean("onboarded", true).apply()
        setSimpleMode(simpleMode)
    }

    fun goBack() {
        if (page == Page.Scan) progress.cancelled.set(true)
        page = PARENT[page] ?: Page.None
    }

    fun changeKeepResults(value: Boolean) {
        keepResults = value
        prefs.edit().putBoolean("keepResults", value).apply()
        if (!value) thread { SavedScans.forget(context) }
    }

    fun setShop(name: String) {
        shopName = name
        prefs.edit().putString("shopName", name).apply()
    }

    fun setRoot(on: Boolean) {
        rootOn = on
        prefs.edit().putBoolean("root", on).apply()
    }

    fun enterGuest() {
        guest = true
        prefs.edit().putBoolean("guest", true).apply()
        tree = null
        ManualTests.reset(context)
    }

    /** Everything this app holds on this phone goes, and the app closes. */
    fun leaveGuest() {
        context.getSystemService(android.app.ActivityManager::class.java).clearApplicationUserData()
    }

    fun refreshPro() {
        proKey = Licensing.activeKey(context)
    }

    /** Saves after a change so the app opens on what's really there. Off the main thread: it can be large. */
    fun saveLater() {
        val t = tree ?: return
        if (!keepResults || guest) return
        val at = finishedAt
        thread(name = "jard-save") { runCatching { SavedScans.save(context, t, at) } }
    }

    var tree by mutableStateOf<ScanTree?>(null)
    /** Bumps when the tree or the quarantine changed, so screens read them again. */
    var version by mutableIntStateOf(0)
    var scanning by mutableStateOf(false)
    var progress by mutableStateOf(ScanProgress())
    var scanError by mutableStateOf<String?>(null)
    var finishedAt by mutableStateOf(0L)
    /** How the last scan ended when the permission went: how far it got, and whether anything was kept. */
    var lostFiles by mutableStateOf(0L)
    var lostPercent by mutableStateOf(0)
    /** The system closed the app during a scan, so nothing from it survived. */
    var scanInterrupted by mutableStateOf(prefs.getBoolean("scanRunning", false))

    var picked by mutableStateOf(loadPicked())
    var storage by mutableStateOf(Device.storage(context))
    var apps by mutableStateOf<List<AppSize>?>(null)

    init {
        I18n.init(context)
        if (scanInterrupted) {
            prefs.edit().remove("scanRunning").apply()
            page = Page.ScanLost
        }
        thread(name = "jard-load") {
            proKey = Licensing.activeKey(context)
            if (keepResults && !guest && tree == null) {
                SavedScans.load(context)?.let { (t, at) ->
                    if (tree == null) {
                        tree = t
                        finishedAt = at
                        version++
                    }
                }
            }
        }
    }

    private fun loadPicked(): List<Uri> =
        prefs.getStringSet("picked", emptySet()).orEmpty().map(Uri::parse).sortedBy { it.toString() }

    fun addPicked(uri: Uri) {
        context.contentResolver.takePersistableUriPermission(uri, android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION or android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        picked = (picked + uri).distinct()
        prefs.edit().putStringSet("picked", picked.map { it.toString() }.toSet()).apply()
    }

    fun removePicked(uri: Uri) {
        runCatching { context.contentResolver.releasePersistableUriPermission(uri, android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION or android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION) }
        picked = picked - uri
        prefs.edit().putStringSet("picked", picked.map { it.toString() }.toSet()).apply()
    }

    val canScan: Boolean get() = Device.hasAllFiles(context) || picked.isNotEmpty()

    fun setTheme(value: Boolean?) {
        dark = value
        prefs.edit().putString("theme", when (value) { true -> "dark"; false -> "light"; null -> "system" }).apply()
    }

    fun setSimpleMode(value: Boolean) {
        simple = value
        prefs.edit().putBoolean("simple", value).apply()
    }

    fun startScan() {
        if (scanning) return
        if (!canScan) {
            page = Page.Permission
            return
        }
        val p = ScanProgress()
        progress = p
        scanning = true
        scanError = null
        scanInterrupted = false
        prefs.edit().putBoolean("scanRunning", true).apply()
        page = Page.Scan
        storage = Device.storage(context)
        thread(name = "jard-scan") {
            val result = runCatching {
                if (Device.hasAllFiles(context)) Scanner.scanFiles(Environment.getExternalStorageDirectory(), p) { Device.hasAllFiles(context) }
                else Scanner.scanPicked(context, picked, p)
            }
            result.onSuccess {
                tree = it
                finishedAt = System.currentTimeMillis()
                if (keepResults && !guest) {
                    runCatching {
                        SavedScans.save(context, it, finishedAt)
                        SavedScans.addSummary(context, it, finishedAt / 1000)
                    }
                    JardWidget.refresh(context)
                }
            }
            result.onFailure { scanError = it.message ?: "تعذّر الفحص." }
            prefs.edit().remove("scanRunning").apply()
            if (p.permissionLost.get()) {
                lostFiles = p.files.get()
                lostPercent = (p.bytes.get() * 100 / storage.used.coerceAtLeast(1)).coerceAtMost(99).toInt()
            }
            scanning = false
            version++
        }
    }

    fun refreshApps() {
        if (!Device.hasUsageAccess(context)) {
            apps = null
            return
        }
        thread(name = "jard-apps") { apps = Device.apps(context) }
    }

    fun refreshStorage(): StorageTotals = Device.storage(context).also { storage = it }
}
