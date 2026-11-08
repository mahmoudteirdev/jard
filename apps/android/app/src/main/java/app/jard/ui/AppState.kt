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
import app.jard.engine.QuarantineStore
import app.jard.engine.ScanProgress
import app.jard.engine.ScanTree
import app.jard.engine.Scanner
import app.jard.engine.StorageTotals
import kotlin.concurrent.thread

enum class Tab { Home, Files, Apps, Check, More }

/** Screens over the tabs. */
enum class Page { None, Permission, Scan, History, Settings, About, Tools }

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

    var tree by mutableStateOf<ScanTree?>(null)
    /** Bumps when the tree or the quarantine changed, so screens read them again. */
    var version by mutableIntStateOf(0)
    var scanning by mutableStateOf(false)
    var progress by mutableStateOf(ScanProgress())
    var scanError by mutableStateOf<String?>(null)
    var finishedAt by mutableStateOf(0L)

    var picked by mutableStateOf(loadPicked())
    var storage by mutableStateOf(Device.storage(context))
    var apps by mutableStateOf<List<AppSize>?>(null)

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
        page = Page.Scan
        storage = Device.storage(context)
        thread(name = "jard-scan") {
            val result = runCatching {
                if (Device.hasAllFiles(context)) Scanner.scanFiles(Environment.getExternalStorageDirectory(), p)
                else Scanner.scanPicked(context, picked, p)
            }
            result.onSuccess {
                tree = it
                finishedAt = System.currentTimeMillis()
            }
            result.onFailure { scanError = it.message ?: "تعذّر الفحص." }
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
