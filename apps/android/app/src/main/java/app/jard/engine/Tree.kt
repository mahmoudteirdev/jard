package app.jard.engine

/**
 * The same shape as the desktop engine: a flat list where a child always comes after its parent,
 * so totals add up in one backward pass, and every folder has apparent size and size on disk.
 */
class FileNode(
    @JvmField val id: Int,
    @JvmField val name: String,
    @JvmField val parent: Int,
    @JvmField val isDir: Boolean,
    /** Where it really is: a path, or a content:// address when the folder was picked by the person. */
    @JvmField val location: String,
    @JvmField var apparent: Long = 0,
    @JvmField var onDisk: Long = 0,
    @JvmField var modified: Long = 0,
    @JvmField var files: Long = 0,
    @JvmField var dirs: Long = 0,
    @JvmField var denied: Boolean = false,
    @JvmField var partial: Boolean = false,
    @JvmField var isLink: Boolean = false,
) {
    @JvmField val children: ArrayList<Int> = ArrayList(0)
}

class ScanTree(val nodes: ArrayList<FileNode>, val rootLabel: String, val partial: Boolean, val scope: Scope) {
    enum class Scope { AllFiles, Picked }

    val root: FileNode get() = nodes[0]

    fun children(id: Int, sort: FileSort): List<FileNode> {
        val kids = nodes[id].children.map { nodes[it] }
        return when (sort) {
            FileSort.Largest -> kids.sortedByDescending { it.onDisk }
            FileSort.Oldest -> kids.sortedWith(compareBy<FileNode> { if (it.modified == 0L) Long.MAX_VALUE else it.modified })
        }
    }

    /** The nodes from the root down to [id]. */
    fun chain(id: Int): List<FileNode> {
        val out = ArrayList<FileNode>()
        var cur = id
        while (cur >= 0) {
            out.add(nodes[cur])
            cur = nodes[cur].parent
        }
        return out.asReversed()
    }

    /** Takes a node out after it left the disk, so totals shrink without a new scan. */
    fun detach(id: Int) = shift(id, -1)

    /** Puts it back after a restore. */
    fun reattach(id: Int) = shift(id, 1)

    private fun shift(id: Int, sign: Int) {
        val n = nodes[id]
        if (n.parent < 0) return
        val p = nodes[n.parent]
        if (sign < 0) p.children.remove(Integer.valueOf(id)) else p.children.add(id)
        var cur = n.parent
        while (cur >= 0) {
            val a = nodes[cur]
            a.apparent += sign * n.apparent
            a.onDisk += sign * n.onDisk
            a.files += sign * n.files
            a.dirs += sign * (n.dirs + if (n.isDir) 1 else 0)
            cur = a.parent
        }
    }

    /** Adds every folder into its parent. Children come after parents, so one backward pass is enough. */
    fun rollUp() {
        for (i in nodes.indices.reversed()) {
            val n = nodes[i]
            if (n.parent < 0) continue
            val p = nodes[n.parent]
            p.apparent += n.apparent
            p.onDisk += n.onDisk
            p.files += n.files
            p.dirs += n.dirs + if (n.isDir) 1 else 0
            if (n.partial) p.partial = true
        }
    }
}

enum class FileSort { Largest, Oldest }

enum class FileKind(val label: String) {
    Video("الفيديو"),
    Image("الصور"),
    Audio("الصوت"),
    Document("المستندات"),
    Archive("الأرشيف"),
    Other("أخرى");

    companion object {
        private val map: Map<String, FileKind> = buildMap {
            for (e in listOf("mp4", "mkv", "mov", "avi", "webm", "3gp", "m4v")) put(e, Video)
            for (e in listOf("jpg", "jpeg", "png", "gif", "heic", "webp", "bmp", "dng")) put(e, Image)
            for (e in listOf("mp3", "wav", "flac", "aac", "ogg", "m4a", "opus")) put(e, Audio)
            for (e in listOf("pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "epub")) put(e, Document)
            for (e in listOf("zip", "rar", "7z", "tar", "gz", "apk", "xapk", "iso")) put(e, Archive)
        }

        fun of(name: String): FileKind = map[name.substringAfterLast('.', "").lowercase()] ?: Other
    }
}

/** On-disk totals per kind, largest first. */
fun kindTotals(tree: ScanTree): List<Pair<FileKind, Long>> {
    val totals = HashMap<FileKind, Long>()
    for (n in tree.nodes) if (!n.isDir) totals.merge(FileKind.of(n.name), n.onDisk, Long::plus)
    return totals.entries.filter { it.value > 0 }.map { it.key to it.value }.sortedByDescending { it.second }
}

/** Largest files that haven't changed in a while. */
fun largestFiles(tree: ScanTree, limit: Int): List<FileNode> =
    tree.nodes.asSequence().filter { !it.isDir && it.parent >= 0 && !isDetached(tree, it) }
        .sortedByDescending { it.onDisk }.take(limit).toList()

private fun isDetached(tree: ScanTree, n: FileNode): Boolean {
    var cur = n
    while (cur.parent >= 0) {
        val p = tree.nodes[cur.parent]
        if (cur.id !in p.children) return true
        cur = p
    }
    return false
}

/** Folders at the top of shared storage that apps and people expect to exist. */
private val ROOT_FOLDERS = setOf("android", "dcim", "download", "documents", "movies", "music", "pictures", "alarms", "notifications", "podcasts", "ringtones", "audiobooks", "recordings")

/** Why this may not be moved, or null if it may. Checked before any move, whoever asks. */
fun protectedReason(tree: ScanTree, n: FileNode): String? {
    if (n.parent < 0) return "التخزين كله: اختر ما بداخله."
    if (n.isLink) return "اختصار يشير لمكان آخر."
    if (n.name == QUARANTINE_DIR) return "ملفات الحجر المؤقت نفسها."
    val atTop = n.parent == 0 && tree.scope == ScanTree.Scope.AllFiles
    if (atTop && n.name.lowercase() in ROOT_FOLDERS) return "مجلد أساسي والتطبيقات تتوقع وجوده. اختر ما بداخله."
    return null
}

const val QUARANTINE_DIR = ".jard-quarantine"
