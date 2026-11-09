package app.jard.engine

import android.Manifest
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import java.io.File
import java.util.zip.ZipFile

data class Finding(val title: String, val apps: List<String>, val why: String, val warn: Boolean)

data class PermissionUse(val name: String, val apps: List<String>)

data class TrackerHit(val app: String, val trackers: List<String>)

/** What's on the phone that's worth a look. Being listed doesn't mean harmful: we describe, the person decides. */
object Security {
    private val PERMISSIONS = listOf(
        "الموقع" to listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
        "الكاميرا" to listOf(Manifest.permission.CAMERA),
        "الميكروفون" to listOf(Manifest.permission.RECORD_AUDIO),
        "الرسائل" to listOf(Manifest.permission.READ_SMS, Manifest.permission.SEND_SMS),
        "جهات الاتصال" to listOf(Manifest.permission.READ_CONTACTS),
        "المكالمات" to listOf(Manifest.permission.READ_CALL_LOG, Manifest.permission.CALL_PHONE),
    )

    private fun label(context: Context, a: ApplicationInfo) = context.packageManager.getApplicationLabel(a).toString()

    private fun isUserApp(a: ApplicationInfo) = a.flags and ApplicationInfo.FLAG_SYSTEM == 0

    private fun packages(context: Context): List<PackageInfo> =
        context.packageManager.getInstalledPackages(PackageManager.GET_PERMISSIONS)

    private fun installer(context: Context, pkg: String): String? = runCatching {
        val pm = context.packageManager
        if (Build.VERSION.SDK_INT >= 30) pm.getInstallSourceInfo(pkg).installingPackageName else @Suppress("DEPRECATION") pm.getInstallerPackageName(pkg)
    }.getOrNull()

    private val STORES = setOf("com.android.vending", "com.sec.android.app.samsungapps", "com.huawei.appmarket", "com.xiaomi.market", "com.amazon.venezia", "com.oppo.market", "com.heytap.market", "com.vivo.appstore")

    fun findings(context: Context): List<Finding> {
        val pm = context.packageManager
        val out = ArrayList<Finding>()

        val accessibility = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES).orEmpty()
            .split(':').filter { it.isNotBlank() }
            .map { it.substringBefore('/') }.distinct()
            .map { runCatching { pm.getApplicationLabel(pm.getApplicationInfo(it, 0)).toString() }.getOrDefault(it) }
        if (accessibility.isNotEmpty()) out.add(Finding("خدمة وصول مفعّلة", accessibility, "تقدر تقرأ ما يظهر على الشاشة. راجعها إذا ما فعّلتها بنفسك.", true))

        val launchable = pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0)
            .map { it.activityInfo.packageName }.toSet()
        val users = pm.getInstalledApplications(0).filter(::isUserApp)
        val hidden = users.filter { it.packageName !in launchable && it.packageName != context.packageName }.map { label(context, it) }
        if (hidden.isNotEmpty()) out.add(Finding("تطبيق بلا أيقونة", hidden, "مخفي من قائمة التطبيقات، وهذا سلوك غير معتاد.", true))

        val outside = users.filter { installer(context, it.packageName) !in STORES && it.packageName != context.packageName }.map { label(context, it) }
        if (outside.isNotEmpty()) out.add(Finding("مثبت من خارج المتجر", outside, "تم تثبيتها من مصدر آخر غير متجر معروف.", false))

        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        val admins = dpm.activeAdmins.orEmpty().map { c ->
            runCatching { pm.getApplicationLabel(pm.getApplicationInfo(c.packageName, 0)).toString() }.getOrDefault(c.packageName)
        }
        if (admins.isNotEmpty()) out.add(Finding("مدير جهاز", admins, "يمكنه قفل الجهاز أو مسحه. هذا طبيعي لتطبيقات مثل العثور على الهاتف.", false))

        val listeners = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners").orEmpty()
            .split(':').filter { it.isNotBlank() }.map { it.substringBefore('/') }.distinct()
            .map { runCatching { pm.getApplicationLabel(pm.getApplicationInfo(it, 0)).toString() }.getOrDefault(it) }
        if (listeners.isNotEmpty()) out.add(Finding("يقرأ الإشعارات", listeners, "يرى نص كل إشعار يصلك، ومنها رموز التحقق.", true))

        return out
    }

    /** Permissions actually granted, to apps the person installed. */
    fun permissions(context: Context): List<PermissionUse> {
        val infos = packages(context).filter { p -> p.applicationInfo?.let(::isUserApp) == true }
        val named = PERMISSIONS.map { (name, perms) ->
            val apps = infos.filter { p ->
                val requested = p.requestedPermissions ?: return@filter false
                val flags = p.requestedPermissionsFlags ?: return@filter false
                requested.indices.any { i -> requested[i] in perms && flags[i] and PackageInfo.REQUESTED_PERMISSION_GRANTED != 0 }
            }.map { label(context, it.applicationInfo!!) }
            PermissionUse(name, apps)
        }
        val allFiles = if (Build.VERSION.SDK_INT >= 30) infos.filter { p ->
            val requested = p.requestedPermissions ?: return@filter false
            Manifest.permission.MANAGE_EXTERNAL_STORAGE in requested && runCatching {
                context.getSystemService(android.app.AppOpsManager::class.java).unsafeCheckOpNoThrow(
                    "android:manage_external_storage", p.applicationInfo!!.uid, p.packageName,
                ) == android.app.AppOpsManager.MODE_ALLOWED
            }.getOrDefault(false)
        }.map { label(context, it.applicationInfo!!) } else emptyList()
        return (named + PermissionUse("كل الملفات", allFiles)).filter { it.apps.isNotEmpty() }.sortedByDescending { it.apps.size }
    }

    /** Known analytics and ad libraries, by the class names their code carries. Reads each app's public package. */
    private val TRACKERS = listOf(
        "Google Analytics / Firebase" to "Lcom/google/firebase/analytics/",
        "Google AdMob" to "Lcom/google/android/gms/ads/",
        "Facebook SDK" to "Lcom/facebook/appevents/",
        "AppsFlyer" to "Lcom/appsflyer/",
        "Adjust" to "Lcom/adjust/sdk/",
        "AppLovin" to "Lcom/applovin/",
        "Unity Ads" to "Lcom/unity3d/ads/",
        "ironSource" to "Lcom/ironsource/",
        "Mixpanel" to "Lcom/mixpanel/",
        "Flurry" to "Lcom/flurry/",
        "Branch" to "Lio/branch/",
        "OneSignal" to "Lcom/onesignal/",
    )

    fun scanTrackers(context: Context, progress: (Int, Int) -> Unit, cancelled: () -> Boolean): List<TrackerHit> {
        // Not Jard itself: the names being searched for are written in its own code.
        val apps = context.packageManager.getInstalledApplications(0).filter { isUserApp(it) && it.packageName != context.packageName }
        val patterns = TRACKERS.map { (name, p) -> name to p.toByteArray() }
        val out = ArrayList<TrackerHit>()
        apps.forEachIndexed { i, a ->
            if (cancelled()) return out
            progress(i, apps.size)
            val found = runCatching { trackersIn(File(a.sourceDir), patterns) }.getOrDefault(emptyList())
            if (found.isNotEmpty()) out.add(TrackerHit(label(context, a), found))
        }
        return out.sortedByDescending { it.trackers.size }
    }

    internal fun trackersIn(apk: File, patterns: List<Pair<String, ByteArray>>): List<String> {
        val hits = LinkedHashSet<String>()
        ZipFile(apk).use { zip ->
            for (e in zip.entries()) {
                if (!e.name.endsWith(".dex") || e.size > 96_000_000) continue
                val bytes = zip.getInputStream(e).use { it.readBytes() }
                for ((name, p) in patterns) if (name !in hits && contains(bytes, p)) hits.add(name)
            }
        }
        return hits.toList()
    }

    internal fun contains(hay: ByteArray, needle: ByteArray): Boolean {
        val first = needle[0]
        var i = 0
        val last = hay.size - needle.size
        while (i <= last) {
            if (hay[i] == first) {
                var j = 1
                while (j < needle.size && hay[i + j] == needle[j]) j++
                if (j == needle.size) return true
            }
            i++
        }
        return false
    }
}
