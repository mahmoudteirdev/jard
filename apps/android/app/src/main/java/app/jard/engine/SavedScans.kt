package app.jard.engine

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.util.zip.GZIPInputStream
import java.util.zip.GZIPOutputStream

/** One scan's top-level folders, kept for "what grew". */
data class ScanSummary(val at: Long, val onDisk: Long, val folders: Map<String, Long>)

data class FolderChange(val name: String, val before: Long, val after: Long) {
    val delta: Long get() = after - before
}

/** The last result on this device, so opening the app doesn't need a new scan. Nothing leaves the phone. */
object SavedScans {
    private const val VERSION = 1
    private const val KEEP_SUMMARIES = 30

    private fun dir(context: Context) = File(context.filesDir, "scans").also { it.mkdirs() }

    fun save(context: Context, tree: ScanTree, at: Long) {
        val tmp = File(dir(context), "latest.tmp")
        DataOutputStream(GZIPOutputStream(FileOutputStream(tmp).buffered())).use { o ->
            write(tree, at, o)
        }
        tmp.renameTo(File(dir(context), "latest.bin"))
    }

    internal fun write(tree: ScanTree, at: Long, o: DataOutputStream) {
        o.writeInt(VERSION)
        o.writeLong(at)
        o.writeBoolean(tree.partial)
        o.writeInt(tree.scope.ordinal)
        o.writeUTF(tree.rootLabel)
        o.writeInt(tree.nodes.size)
        for (n in tree.nodes) {
            o.writeUTF(n.name)
            o.writeInt(n.parent)
            // Paths are the parent's plus the name, except what the system picker addressed for us.
            val derived = n.parent >= 0 && n.location == tree.nodes[n.parent].location + "/" + n.name
            o.writeBoolean(derived)
            if (!derived) o.writeUTF(n.location)
            o.writeBoolean(n.parent >= 0 && n.id !in tree.nodes[n.parent].children) // left the disk since
            var bits = 0
            if (n.isDir) bits = bits or 1
            if (n.denied) bits = bits or 2
            if (n.partial) bits = bits or 4
            if (n.isLink) bits = bits or 8
            o.writeByte(bits)
            o.writeLong(n.apparent)
            o.writeLong(n.onDisk)
            o.writeLong(n.modified)
            o.writeLong(n.files)
            o.writeLong(n.dirs)
        }
    }

    fun load(context: Context): Pair<ScanTree, Long>? {
        val f = File(dir(context), "latest.bin")
        if (!f.exists()) return null
        // A file that can't be read is only a lost convenience: the next scan replaces it.
        return runCatching { DataInputStream(GZIPInputStream(FileInputStream(f).buffered())).use { read(it) } }.getOrNull()
    }

    internal fun read(i: DataInputStream): Pair<ScanTree, Long>? {
        if (i.readInt() != VERSION) return null
        val at = i.readLong()
        val partial = i.readBoolean()
        val scope = ScanTree.Scope.entries[i.readInt()]
        val label = i.readUTF()
        val count = i.readInt()
        val nodes = ArrayList<FileNode>(count)
        for (id in 0 until count) {
            val name = i.readUTF()
            val parent = i.readInt()
            val derived = i.readBoolean()
            val location = if (derived) nodes[parent].location + "/" + name else i.readUTF()
            val detached = i.readBoolean()
            val bits = i.readByte().toInt()
            val n = FileNode(id, name, parent, bits and 1 != 0, location, denied = bits and 2 != 0, partial = bits and 4 != 0, isLink = bits and 8 != 0)
            n.apparent = i.readLong()
            n.onDisk = i.readLong()
            n.modified = i.readLong()
            n.files = i.readLong()
            n.dirs = i.readLong()
            nodes.add(n)
            if (parent >= 0 && !detached) nodes[parent].children.add(id)
        }
        return ScanTree(nodes, label, partial, scope) to at
    }

    fun addSummary(context: Context, tree: ScanTree, at: Long) {
        val folders = JSONObject()
        for (c in tree.root.children) tree.nodes[c].let { if (it.onDisk > 0) folders.put(it.name, it.onDisk) }
        val entry = JSONObject().put("at", at).put("onDisk", tree.root.onDisk).put("folders", folders)
        val list = JSONArray()
        val old = summariesJson(context)
        for (i in maxOf(0, old.length() - KEEP_SUMMARIES + 1) until old.length()) list.put(old.get(i))
        list.put(entry)
        File(dir(context), "summaries.json").writeText(list.toString())
    }

    private fun summariesJson(context: Context): JSONArray =
        runCatching { JSONArray(File(dir(context), "summaries.json").readText()) }.getOrDefault(JSONArray())

    fun summaries(context: Context): List<ScanSummary> {
        val a = summariesJson(context)
        return (0 until a.length()).map { i ->
            val o = a.getJSONObject(i)
            val f = o.getJSONObject("folders")
            ScanSummary(o.getLong("at"), o.getLong("onDisk"), f.keys().asSequence().associateWith { f.getLong(it) })
        }
    }

    /** What changed between two scans, biggest change first. */
    fun changes(a: ScanSummary, b: ScanSummary): List<FolderChange> =
        (a.folders.keys + b.folders.keys)
            .map { FolderChange(it, a.folders[it] ?: 0, b.folders[it] ?: 0) }
            .filter { it.delta != 0L }
            .sortedByDescending { kotlin.math.abs(it.delta) }

    fun forget(context: Context) {
        dir(context).deleteRecursively()
    }
}
