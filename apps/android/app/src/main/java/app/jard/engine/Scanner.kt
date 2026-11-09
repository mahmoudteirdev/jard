package app.jard.engine

import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import android.system.Os
import android.system.OsConstants
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/** Read without locks while scanning, so numbers on screen are approximate until the end. */
class ScanProgress {
    val files = AtomicLong()
    val bytes = AtomicLong()
    val cancelled = AtomicBoolean()
    val paused = AtomicBoolean()
    /** The permission was taken back during the scan, as opposed to one folder refusing. */
    val permissionLost = AtomicBoolean()

    @Volatile
    var current: String = ""
}

object Scanner {
    /** Walks shared storage with the all-files permission. Reads names, sizes and dates, never contents. */
    fun scanFiles(root: File, progress: ScanProgress, allowed: () -> Boolean = { true }): ScanTree {
        val nodes = ArrayList<FileNode>(4096)
        nodes.add(FileNode(0, root.path, -1, true, root.path))
        val stack = ArrayDeque<Int>()
        stack.addLast(0)
        var stopped = false
        var listed = 0
        while (stack.isNotEmpty()) {
            if (progress.cancelled.get()) {
                stopped = true
                // Everything still waiting was not read.
                for (id in stack) nodes[id].partial = true
                break
            }
            while (progress.paused.get() && !progress.cancelled.get()) Thread.sleep(150)
            val id = stack.removeLast()
            val dir = nodes[id]
            progress.current = dir.location
            val entries = File(dir.location).listFiles()
            // Without the permission Android may answer with nothing or with a shortened list, so it's
            // asked directly: whenever a folder refuses, and every so often in case none does.
            listed++
            if ((entries == null || listed % 200 == 0) && !allowed()) {
                progress.permissionLost.set(true)
                stopped = true
                dir.partial = true
                for (waiting in stack) nodes[waiting].partial = true
                break
            }
            if (entries == null) {
                dir.denied = true
                continue
            }
            for (f in entries) {
                val st = try {
                    Os.lstat(f.path)
                } catch (_: Exception) {
                    continue
                }
                val isLink = OsConstants.S_ISLNK(st.st_mode)
                val isDir = !isLink && OsConstants.S_ISDIR(st.st_mode)
                val n = FileNode(nodes.size, f.name, id, isDir, f.path, isLink = isLink)
                if (!isDir) {
                    n.apparent = st.st_size
                    n.onDisk = st.st_blocks * 512
                    n.modified = st.st_mtime
                    n.files = 1
                    progress.files.incrementAndGet()
                    progress.bytes.addAndGet(n.onDisk)
                }
                nodes.add(n)
                dir.children.add(n.id)
                if (isDir) stack.addLast(n.id)
            }
        }
        val tree = ScanTree(nodes, root.path, stopped, ScanTree.Scope.AllFiles)
        tree.rollUp()
        return tree
    }

    /** Walks folders the person picked through the system picker. Slower, and only what they chose. */
    fun scanPicked(context: Context, trees: List<Uri>, progress: ScanProgress): ScanTree {
        val nodes = ArrayList<FileNode>(1024)
        nodes.add(FileNode(0, "المجلدات المختارة", -1, true, ""))
        var stopped = false
        val resolver = context.contentResolver
        val projection = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_SIZE,
            DocumentsContract.Document.COLUMN_LAST_MODIFIED,
        )
        for (tree in trees) {
            val rootDoc = DocumentsContract.getTreeDocumentId(tree)
            val top = FileNode(nodes.size, rootDoc.substringAfterLast(':').ifEmpty { rootDoc }, 0, true,
                DocumentsContract.buildDocumentUriUsingTree(tree, rootDoc).toString())
            nodes.add(top)
            nodes[0].children.add(top.id)
            val stack = ArrayDeque<Pair<Int, String>>()
            stack.addLast(top.id to rootDoc)
            while (stack.isNotEmpty()) {
                if (progress.cancelled.get()) {
                    stopped = true
                    for ((id, _) in stack) nodes[id].partial = true
                    break
                }
                while (progress.paused.get() && !progress.cancelled.get()) Thread.sleep(150)
                val (id, doc) = stack.removeLast()
                progress.current = nodes[id].name
                val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, doc)
                val cursor = try {
                    resolver.query(children, projection, null, null, null)
                } catch (_: Exception) {
                    null
                }
                if (cursor == null) {
                    // The permission was taken back mid-scan, or the folder is gone: keep what we have.
                    nodes[id].partial = true
                    if (resolver.persistedUriPermissions.none { it.uri == tree }) {
                        progress.permissionLost.set(true)
                        stopped = true
                        for ((waiting, _) in stack) nodes[waiting].partial = true
                        break
                    }
                    continue
                }
                cursor.use { c ->
                    while (c.moveToNext()) {
                        val childDoc = c.getString(0)
                        val isDir = c.getString(2) == DocumentsContract.Document.MIME_TYPE_DIR
                        val n = FileNode(nodes.size, c.getString(1) ?: childDoc, id, isDir,
                            DocumentsContract.buildDocumentUriUsingTree(tree, childDoc).toString())
                        if (!isDir) {
                            n.apparent = c.getLong(3)
                            n.onDisk = n.apparent // the picker doesn't report allocated size
                            n.modified = c.getLong(4) / 1000
                            n.files = 1
                            progress.files.incrementAndGet()
                            progress.bytes.addAndGet(n.onDisk)
                        }
                        nodes.add(n)
                        nodes[id].children.add(n.id)
                        if (isDir) stack.addLast(n.id to childDoc)
                    }
                }
            }
        }
        val out = ScanTree(nodes, "المجلدات المختارة", stopped, ScanTree.Scope.Picked)
        out.rollUp()
        return out
    }
}
