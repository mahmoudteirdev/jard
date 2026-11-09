package app.jard.engine

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Environment
import android.widget.RemoteViews
import app.jard.R
import app.jard.ui.I18n
import app.jard.ui.MainActivity
import kotlin.concurrent.thread

private const val DAY = 86_400L
private const val JOB_ID = 1
private const val CHANNEL = "jard"

/** The chores the person turned on. Android runs them when it suits the phone, about once a day. */
object Automation {
    private fun prefs(c: Context) = c.getSharedPreferences("jard", Context.MODE_PRIVATE)

    fun weeklyScan(c: Context) = prefs(c).getBoolean("weeklyScan", false)
    fun weeklyCache(c: Context) = prefs(c).getBoolean("weeklyCache", false)
    fun alertFull(c: Context) = prefs(c).getBoolean("alertFull", false)

    fun set(c: Context, key: String, on: Boolean) {
        prefs(c).edit().putBoolean(key, on).apply()
        schedule(c)
    }

    /** Scheduled only while something is on, so a phone that wants none of this runs nothing. */
    fun schedule(c: Context) {
        val js = c.getSystemService(JobScheduler::class.java)
        if (!(weeklyScan(c) || weeklyCache(c) || alertFull(c))) {
            js.cancel(JOB_ID)
            return
        }
        val job = JobInfo.Builder(JOB_ID, ComponentName(c, ChoresJob::class.java))
            .setPeriodic(DAY * 1000)
            .setPersisted(true)
            .setRequiresBatteryNotLow(true)
            .build()
        js.schedule(job)
    }

    fun canNotify(c: Context) = Build.VERSION.SDK_INT < 33 || c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun notify(c: Context, id: Int, title: String, text: String) {
        if (!canNotify(c)) return
        val nm = c.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, I18n.tr("تنبيهات جَرد"), NotificationManager.IMPORTANCE_DEFAULT))
        val open = PendingIntent.getActivity(c, 0, Intent(c, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        nm.notify(
            id,
            Notification.Builder(c, CHANNEL)
                .setSmallIcon(R.drawable.ic_mono)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(Notification.BigTextStyle().bigText(text))
                .setContentIntent(open)
                .setAutoCancel(true)
                .build(),
        )
    }

    /** Runs today's chores. Returns on its own thread's time: the job waits for it. */
    fun runChores(c: Context, now: Long = System.currentTimeMillis() / 1000) {
        I18n.init(c)
        val p = prefs(c)
        val storage = Device.storage(c)
        if (alertFull(c) && storage.total > 0 && storage.used * 10 >= storage.total * 9 && now - p.getLong("lastFullAlert", 0) >= DAY) {
            p.edit().putLong("lastFullAlert", now).apply()
            notify(c, 1, I18n.tr("المساحة وصلت 90%"), I18n.tr("افتح جرد لتعرف شو ماخذها."))
        }
        val weekAgo = now - 7 * DAY
        if (weeklyScan(c) && p.getLong("lastAutoScan", 0) < weekAgo && Device.hasAllFiles(c)) {
            p.edit().putLong("lastAutoScan", now).apply()
            val tree = runCatching { Scanner.scanFiles(Environment.getExternalStorageDirectory(), ScanProgress()) }.getOrNull()
            if (tree != null) {
                val before = SavedScans.summaries(c).lastOrNull()
                if (p.getBoolean("keepResults", true)) {
                    SavedScans.save(c, tree, now * 1000)
                    SavedScans.addSummary(c, tree, now)
                }
                val grew = before?.let { b -> SavedScans.summaries(c).lastOrNull()?.let { a -> SavedScans.changes(b, a).firstOrNull { it.delta > 0 } } }
                val text = if (grew != null) I18n.tr("زادت {} بمقدار {} هذا الأسبوع.", grew.name, sizeText(grew.delta)) else I18n.tr("ما في تغيير كبير هذا الأسبوع.")
                notify(c, 2, I18n.tr("انتهى الفحص الأسبوعي"), text)
            }
        }
        if (weeklyCache(c) && p.getLong("lastAutoCache", 0) < weekAgo && Privileged.level(c) != Access.Normal) {
            p.edit().putLong("lastAutoCache", now).apply()
            for (a in c.packageManager.getInstalledApplications(0)) Privileged.clearCache(c, a.packageName)
        }
        JardWidget.refresh(c)
    }
}

class ChoresJob : JobService() {
    override fun onStartJob(params: JobParameters): Boolean {
        thread(name = "jard-chores") {
            runCatching { Automation.runChores(this) }
            jobFinished(params, false)
        }
        return true
    }

    override fun onStopJob(params: JobParameters) = true
}

/** Survives a restart: scheduled jobs are persisted, but widgets and language need their first read. */
object JardWidget {
    fun refresh(c: Context) {
        val am = AppWidgetManager.getInstance(c)
        am.getAppWidgetIds(ComponentName(c, LargeWidget::class.java)).takeIf { it.isNotEmpty() }?.let { LargeWidget.update(c, am, it) }
        am.getAppWidgetIds(ComponentName(c, SmallWidget::class.java)).takeIf { it.isNotEmpty() }?.let { SmallWidget.update(c, am, it) }
    }

    fun openApp(c: Context): PendingIntent = PendingIntent.getActivity(c, 0, Intent(c, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
}

class LargeWidget : AppWidgetProvider() {
    override fun onUpdate(c: Context, am: AppWidgetManager, ids: IntArray) = update(c, am, ids)

    companion object {
        fun update(c: Context, am: AppWidgetManager, ids: IntArray) {
            I18n.init(c)
            val s = Device.storage(c)
            val last = SavedScans.summaries(c).lastOrNull()
            val biggest = last?.folders?.maxByOrNull { it.value }?.key
            val v = RemoteViews(c.packageName, R.layout.widget_large)
            v.setTextViewText(R.id.title, I18n.tr("التخزين"))
            v.setTextViewText(R.id.size, "${sizeText(s.used)} / ${sizeText(s.total)}")
            v.setProgressBar(R.id.bar, 100, if (s.total > 0) (s.used * 100 / s.total).toInt() else 0, false)
            v.setTextViewText(R.id.cause, if (biggest != null) I18n.tr("أكبر سبب: {}", biggest) else I18n.tr("افحص لتعرف أين ذهبت المساحة."))
            v.setTextViewText(R.id.when_scanned, if (last != null) I18n.tr("آخر فحص: {}", I18n.tr(agoText(last.at))) else "")
            v.setOnClickPendingIntent(R.id.root, JardWidget.openApp(c))
            am.updateAppWidget(ids, v)
        }
    }
}

class SmallWidget : AppWidgetProvider() {
    override fun onUpdate(c: Context, am: AppWidgetManager, ids: IntArray) = update(c, am, ids)

    companion object {
        fun update(c: Context, am: AppWidgetManager, ids: IntArray) {
            I18n.init(c)
            val v = RemoteViews(c.packageName, R.layout.widget_small)
            v.setTextViewText(R.id.title, I18n.tr("متاح"))
            v.setTextViewText(R.id.size, sizeText(Device.storage(c).free))
            v.setOnClickPendingIntent(R.id.root, JardWidget.openApp(c))
            am.updateAppWidget(ids, v)
        }
    }
}
