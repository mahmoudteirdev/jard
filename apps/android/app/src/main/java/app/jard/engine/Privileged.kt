package app.jard.engine

import android.content.Context
import android.content.pm.PackageManager
import org.json.JSONArray
import org.json.JSONObject
import rikka.shizuku.Shizuku
import java.io.File
import java.util.concurrent.TimeUnit

data class CommandResult(val code: Int, val out: String) {
    val ok: Boolean get() = code == 0
}

enum class Access { Normal, Shizuku, Root }

/**
 * The two optional ways past Android's limits. Read-only unless the person confirms, and every command
 * is recorded so they can review it. Without either, the app works and says what it can't see.
 */
object Privileged {
    private const val TIMEOUT_S = 30L

    private fun runProcess(p: Process, timeoutS: Long = TIMEOUT_S): CommandResult {
        val text = StringBuilder()
        val reader = Thread { runCatching { p.inputStream.bufferedReader().forEachLine { text.append(it).append('\n') } } }.apply { start() }
        val errors = Thread { runCatching { p.errorStream.bufferedReader().forEachLine { text.append(it).append('\n') } } }.apply { start() }
        if (!p.waitFor(timeoutS, TimeUnit.SECONDS)) {
            p.destroy()
            return CommandResult(-1, "انتهى الوقت.")
        }
        reader.join(1000)
        errors.join(1000)
        return CommandResult(p.exitValue(), text.toString())
    }

    /** Asks the root manager: the first call is what shows its prompt. False: not rooted, or refused. */
    fun requestRoot(): Boolean = runCatching { runProcess(ProcessBuilder("su", "-c", "id").start(), 60).let { it.ok && "uid=0" in it.out } }.getOrDefault(false)

    fun rootCommand(context: Context, command: String): CommandResult {
        record(context, "root", command)
        return runCatching { runProcess(ProcessBuilder("su", "-c", command).start()) }.getOrElse { CommandResult(-1, it.message.orEmpty()) }
    }

    fun shizukuRunning(): Boolean = runCatching { Shizuku.pingBinder() }.getOrDefault(false)

    fun shizukuGranted(): Boolean = shizukuRunning() && runCatching { Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED }.getOrDefault(false)

    fun requestShizuku(code: Int) {
        runCatching { Shizuku.requestPermission(code) }
    }

    fun shizukuCommand(context: Context, command: String): CommandResult {
        record(context, "shizuku", command)
        // Its process call isn't public API in this library version, but it has been stable for years.
        return runCatching {
            val m = Shizuku::class.java.getDeclaredMethod("newProcess", Array<String>::class.java, Array<String>::class.java, String::class.java)
            m.isAccessible = true
            runProcess(m.invoke(null, arrayOf("sh", "-c", command), null, null) as Process)
        }.getOrElse { CommandResult(-1, it.message.orEmpty()) }
    }

    /** The strongest way that's turned on. */
    fun level(context: Context): Access = when {
        context.getSharedPreferences("jard", Context.MODE_PRIVATE).getBoolean("root", false) -> Access.Root
        shizukuGranted() -> Access.Shizuku
        else -> Access.Normal
    }

    fun command(context: Context, command: String): CommandResult = when (level(context)) {
        Access.Root -> rootCommand(context, command)
        Access.Shizuku -> shizukuCommand(context, command)
        Access.Normal -> CommandResult(-1, "يحتاج Shizuku أو روت.")
    }

    /** `du -k`'s output: what's inside a folder Android keeps closed. */
    internal fun parseDu(text: String): List<Pair<String, Long>> =
        text.lineSequence().mapNotNull { line ->
            val tab = line.indexOfFirst { it == '\t' || it == ' ' }
            if (tab <= 0) return@mapNotNull null
            val kb = line.substring(0, tab).toLongOrNull() ?: return@mapNotNull null
            line.substring(tab + 1).trim().takeIf { it.isNotEmpty() }?.let { it to kb * 1024 }
        }.sortedByDescending { it.second }.toList()

    fun folderSizes(context: Context, path: String): List<Pair<String, Long>> {
        // Fixed paths, or a package name below: nothing the person types reaches this shell line.
        require(path.matches(Regex("[A-Za-z0-9_./-]+")))
        return parseDu(command(context, "du -k -d 1 $path 2>/dev/null").out).filter { it.first != path }
    }

    /** Clears one app's cache. Android 12 and newer accept this from Shizuku or root. */
    fun clearCache(context: Context, pkg: String): CommandResult {
        require(pkg.matches(Regex("[A-Za-z0-9_.]+")))
        return command(context, "pm clear --cache-only $pkg")
    }

    private fun logFile(context: Context) = File(context.filesDir, "commands.json")

    private fun record(context: Context, via: String, command: String) {
        val list = runCatching { JSONArray(logFile(context).readText()) }.getOrDefault(JSONArray())
        val out = JSONArray()
        for (i in maxOf(0, list.length() - 199) until list.length()) out.put(list.get(i))
        out.put(JSONObject().put("at", System.currentTimeMillis() / 1000).put("via", via).put("cmd", command))
        logFile(context).writeText(out.toString())
    }

    /** Every command run with extra rights, newest first. */
    fun history(context: Context): List<Triple<Long, String, String>> {
        val a = runCatching { JSONArray(logFile(context).readText()) }.getOrDefault(JSONArray())
        return (a.length() - 1 downTo 0).map { i -> a.getJSONObject(i).let { Triple(it.getLong("at"), it.getString("via"), it.getString("cmd")) } }
    }
}
