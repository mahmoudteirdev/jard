package app.jard.engine

import android.content.Context
import android.content.Intent
import android.net.Uri
import java.io.File

object TermuxBridge {
    const val PACKAGE_NAME = "com.termux"
    const val USR_DIR = "/data/data/com.termux/files/usr"
    const val HOME_DIR = "/data/data/com.termux/files/home"
    const val BIN_DIR = "$USR_DIR/bin"

    fun isInstalled(context: Context): Boolean = runCatching {
        context.packageManager.getPackageInfo(PACKAGE_NAME, 0)
        true
    }.getOrDefault(false)

    /**
     * Executes a command within Termux's Linux userspace environment using Root (su).
     * Automatically sets up PATH, PREFIX, LD_LIBRARY_PATH, and HOME.
     */
    fun runInTermux(context: Context, command: String): CommandResult {
        val script = """
            export PREFIX=$USR_DIR
            export PATH=$BIN_DIR:${'$'}PATH
            export LD_LIBRARY_PATH=$USR_DIR/lib
            export HOME=$HOME_DIR
            cd ${'$'}HOME
            $command
        """.trimIndent()
        return Privileged.rootCommand(context, script)
    }

    /**
     * Checks if a specific tool (e.g. node, python, git) is installed in Termux.
     */
    fun hasTool(context: Context, toolName: String): Boolean {
        val check = runInTermux(context, "command -v $toolName")
        return check.ok && check.out.isNotBlank()
    }

    /**
     * Launches the Termux app foreground activity.
     */
    fun openTermux(context: Context) {
        val launchIntent = context.packageManager.getLaunchIntentForPackage(PACKAGE_NAME)
        if (launchIntent != null) {
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(launchIntent)
        }
    }
}
