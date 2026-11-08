package app.jard.engine

import android.content.Context
import android.net.Uri
import android.os.Environment
import android.provider.DocumentsContract
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Moved aside for 30 days and can be put back. Nothing is deleted until then, or until asked. */
data class QuarantineItem(
    val id: String,
    val name: String,
    /** Path, or content:// address of the document. */
    val original: String,
    /** Where it sits now. */
    val held: String,
    /** The document's parent before the move, for picked folders. */
    val parentUri: String?,
    val onDisk: Long,
    val movedAt: Long,
    val expiresAt: Long,
) {
    fun daysLeft(now: Long = System.currentTimeMillis() / 1000): Int =
        ((expiresAt - now + 86_399) / 86_400).toInt().coerceAtLeast(0)
}

sealed class MoveResult {
    data class Moved(val item: QuarantineItem) : MoveResult()
    data class Failed(val why: String) : MoveResult()
}

object Retention {
    const val DAYS = 30L
    const val SECONDS = DAYS * 86_400
}

class QuarantineStore(private val context: Context) {
    private val index = File(context.filesDir, "quarantine.json")
    private val log = File(context.filesDir, "log.txt")

    fun list(): List<QuarantineItem> {
        if (!index.exists()) return emptyList()
        return try {
            val a = JSONArray(index.readText())
            List(a.length()) { i ->
                val o = a.getJSONObject(i)
                QuarantineItem(
                    o.getString("id"), o.getString("name"), o.getString("original"), o.getString("held"),
                    if (o.isNull("parentUri")) null else o.getString("parentUri"),
                    o.getLong("onDisk"), o.getLong("movedAt"), o.getLong("expiresAt"),
                )
            }.sortedBy { it.expiresAt }
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun save(items: List<QuarantineItem>) {
        val a = JSONArray()
        for (i in items) {
            a.put(
                JSONObject().put("id", i.id).put("name", i.name).put("original", i.original).put("held", i.held)
                    .put("parentUri", i.parentUri ?: JSONObject.NULL).put("onDisk", i.onDisk)
                    .put("movedAt", i.movedAt).put("expiresAt", i.expiresAt),
            )
        }
        val tmp = File(index.path + ".tmp")
        tmp.writeText(a.toString())
        tmp.renameTo(index)
    }

    /** The move is a rename on the same storage, so it happens whole or not at all. */
    fun move(tree: ScanTree, n: FileNode): MoveResult {
        protectedReason(tree, n)?.let { return MoveResult.Failed(it) }
        val now = System.currentTimeMillis() / 1000
        val id = "$now-${System.nanoTime()}"
        val result = if (n.location.startsWith("content://")) movePicked(tree, n) else moveFile(n, id)
        return result.fold(
            onSuccess = { (held, parent) ->
                val item = QuarantineItem(id, n.name, n.location, held, parent, n.onDisk, now, now + Retention.SECONDS)
                save(list() + item)
                appendLog("نقل إلى الحجر", n.onDisk)
                MoveResult.Moved(item)
            },
            onFailure = { MoveResult.Failed(it.message ?: "تعذّر النقل") },
        )
    }

    private fun moveFile(n: FileNode, id: String): Result<Pair<String, String?>> {
        val source = File(n.location)
        if (!source.exists()) return Result.failure(Exception("لم يعد موجوداً في مكانه."))
        val root = File(Environment.getExternalStorageDirectory(), "$QUARANTINE_DIR/$id")
        if (!root.mkdirs()) return Result.failure(Exception("تعذّر إنشاء الحجر. تأكد من صلاحية الملفات."))
        val target = File(root, source.name)
        if (!source.renameTo(target)) {
            root.delete()
            return Result.failure(Exception("رفض النظام النقل. ممكن يكون الملف مستخدماً أو خارج صلاحيتنا."))
        }
        return Result.success(target.path to null)
    }

    private fun movePicked(tree: ScanTree, n: FileNode): Result<Pair<String, String?>> {
        val resolver = context.contentResolver
        return runCatching {
            val uri = Uri.parse(n.location)
            val parent = Uri.parse(tree.nodes[n.parent].location)
            // Inside the same picked folder: its top holds the hidden quarantine folder.
            val top = tree.chain(n.id)[1]
            val topUri = Uri.parse(top.location)
            if (top.id == n.id) throw Exception("اختر ما بداخل المجلد، أو أزله من القائمة.")
            val holder = findOrCreateHolder(topUri)
            val moved = DocumentsContract.moveDocument(resolver, uri, parent, holder)
                ?: throw Exception("رفض النظام النقل.")
            moved.toString() to parent.toString()
        }
    }

    private fun findOrCreateHolder(topUri: Uri): Uri {
        val resolver = context.contentResolver
        val children = DocumentsContract.buildChildDocumentsUriUsingTree(topUri, DocumentsContract.getDocumentId(topUri))
        resolver.query(children, arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)?.use { c ->
            while (c.moveToNext()) {
                if (c.getString(1) == QUARANTINE_DIR) return DocumentsContract.buildDocumentUriUsingTree(topUri, c.getString(0))
            }
        }
        return DocumentsContract.createDocument(resolver, topUri, DocumentsContract.Document.MIME_TYPE_DIR, QUARANTINE_DIR)
            ?: throw Exception("تعذّر إنشاء الحجر.")
    }

    /** Puts an item back. Never overwrites: if something took its place, it comes back with a new name. */
    fun restore(item: QuarantineItem): String? {
        val done = if (item.held.startsWith("content://")) restorePicked(item) else restoreFile(item)
        if (done != null) return done
        save(list().filter { it.id != item.id })
        appendLog("استرجاع من الحجر", item.onDisk)
        return null
    }

    private fun restoreFile(item: QuarantineItem): String? {
        val held = File(item.held)
        if (!held.exists()) return "لم يعد في الحجر."
        var target = File(item.original)
        target.parentFile?.mkdirs()
        if (target.exists()) {
            val stem = target.nameWithoutExtension
            val ext = target.extension.let { if (it.isEmpty()) "" else ".$it" }
            var n = 1
            do {
                target = File(target.parentFile, "$stem (مسترجع${if (n == 1) "" else " $n"})$ext")
                n++
            } while (target.exists())
        }
        if (!held.renameTo(target)) return "تعذّر الاسترجاع."
        held.parentFile?.delete()
        File(Environment.getExternalStorageDirectory(), QUARANTINE_DIR).let { if (it.list()?.isEmpty() == true) it.delete() }
        return null
    }

    private fun restorePicked(item: QuarantineItem): String? = try {
        val held = Uri.parse(item.held)
        val holder = DocumentsContract.findDocumentPath(context.contentResolver, held)?.path?.dropLast(1)?.lastOrNull()
        val holderUri = holder?.let { DocumentsContract.buildDocumentUriUsingTree(held, it) }
        val parent = Uri.parse(item.parentUri)
        if (holderUri == null || DocumentsContract.moveDocument(context.contentResolver, held, holderUri, parent) == null) "تعذّر الاسترجاع." else null
    } catch (e: Exception) {
        e.message ?: "تعذّر الاسترجاع."
    }

    /** Deletes an item for good. This frees the space and cannot be undone. */
    fun delete(item: QuarantineItem): String? {
        val ok = if (item.held.startsWith("content://")) {
            runCatching { DocumentsContract.deleteDocument(context.contentResolver, Uri.parse(item.held)) }.getOrDefault(false)
        } else {
            val held = File(item.held)
            // deleteRecursively doesn't enter symbolic links on Android's file system calls.
            val done = !held.exists() || held.deleteRecursively()
            held.parentFile?.delete()
            done
        }
        if (!ok) return "تعذّر الحذف."
        save(list().filter { it.id != item.id })
        appendLog("حذف نهائي من الحجر", item.onDisk)
        return null
    }

    /** Deletes what is past its 30 days. Failures wait for the next start. */
    fun purgeExpired(now: Long = System.currentTimeMillis() / 1000) {
        for (i in list().filter { it.expiresAt <= now }) delete(i)
    }

    private fun appendLog(what: String, bytes: Long) {
        runCatching { log.appendText("${System.currentTimeMillis() / 1000}\t$what\t$bytes\n") }
    }

    /** Newest first. Counts and sizes only, never file names. */
    fun history(limit: Int = 30): List<Triple<Long, String, Long>> =
        if (!log.exists()) emptyList()
        else log.readLines().mapNotNull { l ->
            val p = l.split('\t')
            if (p.size == 3) Triple(p[0].toLong(), p[1], p[2].toLong()) else null
        }.asReversed().take(limit)
}
