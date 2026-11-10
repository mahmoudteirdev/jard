package app.jard.engine

import android.content.Context
import android.os.Environment
import java.io.File

data class AndroidGhostFile(
    val file: File,
    val name: String,
    val path: String,
    val size: Long,
    val lastModified: Long,
    val daysStale: Int,
    val category: String, // "APK", "Archive", "Document", "DiskImage", "Media", "Other"
    val reason: String,
)

object GhostFiles {

    fun scan(context: Context, minDays: Int = 30): List<AndroidGhostFile> {
        val out = mutableListOf<AndroidGhostFile>()
        val now = System.currentTimeMillis()
        val minAgeMs = minDays.toLong() * 86_400_000L

        val roots = listOfNotNull(
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS),
            File("/storage/emulated/0/Download"),
            File("/storage/emulated/0/Downloads"),
        ).filter { it.exists() && it.isDirectory }.distinctBy { it.absolutePath }

        val visited = mutableSetOf<String>()

        for (root in roots) {
            val stack = mutableListOf(root)
            while (stack.isNotEmpty()) {
                val dir = stack.removeAt(stack.size - 1)
                val files = dir.listFiles() ?: continue

                for (f in files) {
                    if (f.isDirectory) {
                        if (!f.name.startsWith(".") && f.name != "Android") {
                            stack.add(f)
                        }
                        continue
                    }

                    if (!visited.add(f.absolutePath)) continue

                    val size = f.length()
                    if (size < 500_000) continue // At least 500 KB

                    val modified = f.lastModified()
                    val ageMs = now - modified
                    if (ageMs < minAgeMs) continue

                    val daysStale = (ageMs / 86_400_000L).toInt()
                    val ext = f.extension.lowercase()

                    val category = when (ext) {
                        "apk", "xapk", "apks" -> "APK"
                        "zip", "rar", "7z", "tar", "gz", "tgz" -> "Archive"
                        "iso", "img" -> "DiskImage"
                        "pdf", "docx", "xlsx", "pptx" -> "Document"
                        "mp4", "mkv", "avi", "mov" -> "Media"
                        else -> if (size >= 10_000_000) "Other" else continue
                    }

                    val reason = "تم تنزيله قبل $daysStale يوماً ولم يُعدل أو يُفتح منذ ذلك الوقت"

                    out.add(
                        AndroidGhostFile(
                            file = f,
                            name = f.name,
                            path = f.absolutePath,
                            size = size,
                            lastModified = modified,
                            daysStale = daysStale,
                            category = category,
                            reason = reason
                        )
                    )
                }
            }
        }

        out.sortByDescending { it.size }
        return out
    }

    fun cleanFile(context: Context, file: File): Boolean {
        // Moves file to app's internal quarantine or deletes
        return runCatching { file.delete() }.getOrDefault(false)
    }
}
