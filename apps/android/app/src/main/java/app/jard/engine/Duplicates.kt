package app.jard.engine

import android.content.Context
import android.net.Uri
import java.io.File
import java.io.InputStream
import java.security.MessageDigest

/** Copies other than the first of each set of identical files, by content. Largest savings first. */
data class DuplicateCopy(val node: FileNode, val keepPath: String)

object Duplicates {
    private const val MIN_SIZE = 1_000_000L

    fun find(context: Context, tree: ScanTree, cancelled: () -> Boolean): List<DuplicateCopy> {
        val bySize = tree.nodes.filter { !it.isDir && !it.isLink && it.apparent >= MIN_SIZE }.groupBy { it.apparent }
        val out = ArrayList<DuplicateCopy>()
        for ((_, same) in bySize) {
            if (same.size < 2) continue
            if (cancelled()) break
            val byHash = same.groupBy { n -> runCatching { hash(context, n) }.getOrNull() }
            for ((h, group) in byHash) {
                if (h == null || group.size < 2) continue
                val sorted = group.sortedBy { it.location.length }
                sorted.drop(1).forEach { out.add(DuplicateCopy(it, sorted.first().location)) }
            }
        }
        return out.sortedByDescending { it.node.onDisk }
    }

    private fun open(context: Context, n: FileNode): InputStream =
        if (n.location.startsWith("content://")) context.contentResolver.openInputStream(Uri.parse(n.location))!!
        else File(n.location).inputStream()

    private fun hash(context: Context, n: FileNode): String {
        val md = MessageDigest.getInstance("SHA-256")
        open(context, n).use { input ->
            val buf = ByteArray(1024 * 1024)
            while (true) {
                val read = input.read(buf)
                if (read <= 0) break
                md.update(buf, 0, read)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }
}
