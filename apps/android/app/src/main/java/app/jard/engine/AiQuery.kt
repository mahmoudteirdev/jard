package app.jard.engine

import android.content.Context
import android.os.Environment
import java.io.File

data class ParsedAiQuery(
    val rawPrompt: String,
    val recognizedIntent: String,
    val targetKind: String?, // "video", "image", "audio", "document", "archive", "installer"
    val minSize: Long,
    val olderThanMs: Long?,
    val emptyFolders: Boolean,
    val targetFolder: String?,
    val explanationAr: String,
    val explanationEn: String,
    val limit: Int,
)

data class AiQueryResultItem(
    val file: File,
    val name: String,
    val path: String,
    val size: Long,
    val lastModified: Long,
    val isDir: Boolean,
    val kind: String,
)

object AiQuery {

    fun normalizeArabic(text: String): String {
        val sb = StringBuilder(text.length)
        for (c in text) {
            when (c) {
                in '\u064B'..'\u065F', '\u0670' -> continue // Skip diacritics
                'أ', 'إ', 'آ', 'ٱ' -> sb.append('ا')
                'ة' -> sb.append('ه')
                'ى' -> sb.append('ي')
                'ک', 'گ' -> sb.append('ك')
                'ی' -> sb.append('ي')
                else -> sb.append(c.lowercaseChar())
            }
        }
        return sb.toString()
    }

    fun parse(prompt: String, nowMs: Long = System.currentTimeMillis()): ParsedAiQuery {
        val normalized = normalizeArabic(prompt)
        val fullText = normalized

        var emptyFolders = false
        var targetKind: String? = null
        var minSize = 0L
        var olderThanMs: Long? = null
        var targetFolder: String? = null
        var limit = 50
        var intent = "find_files"

        var kindAr = ""
        var kindEn = ""
        var sizeAr = ""
        var sizeEn = ""
        var ageAr = ""
        var ageEn = ""
        var scopeAr = ""
        var scopeEn = ""

        // 1. Empty folders
        if (fullText.contains("فارغ") || fullText.contains("فاضي") || fullText.contains("empty")) {
            emptyFolders = true
            intent = "find_empty_folders"
        }

        // 2. Kind detection
        if (fullText.contains("فيديو") || fullText.contains("فيديوهات") || fullText.contains("مقطع") ||
            fullText.contains("مقاطع") || fullText.contains("مسلسل") || fullText.contains("فيلم") ||
            fullText.contains("افلام") || fullText.contains("video") || fullText.contains("movie") ||
            fullText.contains("clip")
        ) {
            targetKind = "video"
            kindAr = "مقاطع الفيديو"
            kindEn = "videos"
        } else if (fullText.contains("صور") || fullText.contains("صوره") || fullText.contains("لقط") ||
            fullText.contains("سكرين") || fullText.contains("خلفي") || fullText.contains("image") ||
            fullText.contains("photo") || fullText.contains("picture") || fullText.contains("screenshot")
        ) {
            targetKind = "image"
            kindAr = "الصور"
            kindEn = "images"
        } else if (fullText.contains("صوت") || fullText.contains("موسيقى") || fullText.contains("اغاني") ||
            fullText.contains("اغنيه") || fullText.contains("audio") || fullText.contains("music") ||
            fullText.contains("song")
        ) {
            targetKind = "audio"
            kindAr = "الصوتيات"
            kindEn = "audio files"
        } else if (fullText.contains("مستند") || fullText.contains("بي دي اف") || fullText.contains("pdf") ||
            fullText.contains("وورد") || fullText.contains("اكسل") || fullText.contains("doc") ||
            fullText.contains("sheet") || fullText.contains("كتاب") || fullText.contains("كتب")
        ) {
            targetKind = "document"
            kindAr = "المستندات"
            kindEn = "documents"
        } else if (fullText.contains("ارشيف") || fullText.contains("مضغوط") || fullText.contains("zip") ||
            fullText.contains("rar") || fullText.contains("7z") || fullText.contains("tar") ||
            fullText.contains("archive") || fullText.contains("compressed")
        ) {
            targetKind = "archive"
            kindAr = "الملفات المضغوطة"
            kindEn = "archives"
        } else if (fullText.contains("برنامج") || fullText.contains("برامج") || fullText.contains("مثبت") ||
            fullText.contains("تطبيق") || fullText.contains("تنصيب") || fullText.contains("apk") ||
            fullText.contains("installer") || fullText.contains("app")
        ) {
            targetKind = "installer"
            kindAr = "ملفات التثبيت (APK)"
            kindEn = "APK packages"
        }

        // 3. Folder scope
        if (fullText.contains("تنزيل") || fullText.contains("داونلود") || fullText.contains("download")) {
            targetFolder = "Download"
            scopeAr = "في التنزيلات"
            scopeEn = "in Downloads"
        } else if (fullText.contains("كاميرا") || fullText.contains("camera") || fullText.contains("dcim")) {
            targetFolder = "DCIM"
            scopeAr = "في الكاميرا (DCIM)"
            scopeEn = "in DCIM"
        } else if (fullText.contains("واتساب") || fullText.contains("whatsapp")) {
            targetFolder = "WhatsApp"
            scopeAr = "في مجلد واتساب"
            scopeEn = "in WhatsApp"
        }

        // 4. Size extraction
        val words = fullText.split(Regex("[\\s,،:\"]+")).filter { it.isNotEmpty() }
        for (i in words.indices) {
            val w = words[i]
            val num = w.toDoubleOrNull()
            if (num != null && i + 1 < words.size) {
                val next = words[i + 1]
                if (next.contains("جيجا") || next.contains("غيغا") || next == "gb" || next == "gig") {
                    minSize = (num * 1024.0 * 1024.0 * 1024.0).toLong()
                    sizeAr = "أكبر من $num جيجابايت"
                    sizeEn = "larger than $num GB"
                    break
                } else if (next.contains("ميجا") || next.contains("ميغا") || next == "mb" || next == "meg") {
                    minSize = (num * 1024.0 * 1024.0).toLong()
                    sizeAr = "أكبر من $num ميجابايت"
                    sizeEn = "larger than $num MB"
                    break
                }
            }
        }

        if (minSize == 0L) {
            if (fullText.contains("نص جيجا") || fullText.contains("نصف جيجا") || fullText.contains("500mb") || fullText.contains("500 ميغا") || fullText.contains("500 ميجا")) {
                minSize = 500L * 1024L * 1024L
                sizeAr = "أكبر من 500 ميجابايت"
                sizeEn = "larger than 500 MB"
            } else if (fullText.contains("جيجا") || fullText.contains("غيغا") || fullText.contains("1gb")) {
                minSize = 1024L * 1024L * 1024L
                sizeAr = "أكبر من 1 جيجابايت"
                sizeEn = "larger than 1 GB"
            } else if (fullText.contains("اكبر") || fullText.contains("كبير") || fullText.contains("ضخم") ||
                fullText.contains("large") || fullText.contains("huge")
            ) {
                minSize = 100L * 1024L * 1024L
                sizeAr = "الملفات الكبيرة (> 100 MB)"
                sizeEn = "large files (> 100 MB)"
            }
        }

        // 5. Age extraction
        var ageMs: Long? = null
        if (fullText.contains("سنتين") || fullText.contains("2 years")) {
            ageMs = 2L * 365L * 86_400_000L
            ageAr = "أقدم من سنتين"
            ageEn = "older than 2 years"
        } else if (fullText.contains("سنه") || fullText.contains("عام") || fullText.contains("1 year")) {
            ageMs = 365L * 86_400_000L
            ageAr = "أقدم من سنة"
            ageEn = "older than 1 year"
        } else if (fullText.contains("6 شهور") || fullText.contains("نص سنه") || fullText.contains("6 months")) {
            ageMs = 180L * 86_400_000L
            ageAr = "أقدم من 6 أشهر"
            ageEn = "older than 6 months"
        } else if (fullText.contains("شهرين") || fullText.contains("2 months")) {
            ageMs = 60L * 86_400_000L
            ageAr = "أقدم من شهرين"
            ageEn = "older than 2 months"
        } else if (fullText.contains("شهر") || fullText.contains("30 يوم") || fullText.contains("30 days")) {
            ageMs = 30L * 86_400_000L
            ageAr = "أقدم من 30 يوماً"
            ageEn = "older than 30 days"
        } else if (fullText.contains("قديم") || fullText.contains("مهجور") || fullText.contains("متروك") ||
            fullText.contains("old") || fullText.contains("stale")
        ) {
            ageMs = 90L * 86_400_000L
            ageAr = "المتروكة منذ 90 يوماً فما فوق"
            ageEn = "stale for 90+ days"
        }

        if (ageMs != null) {
            olderThanMs = nowMs - ageMs
        }

        // 6. Limit
        for (i in words.indices) {
            if (words[i] == "top" || words[i] == "اول" || words[i] == "اكبر") {
                if (i + 1 < words.size) {
                    val n = words[i + 1].toIntOrNull()
                    if (n != null && n in 1..200) {
                        limit = n
                    }
                }
            }
        }

        // 7. Explanations
        val partsAr = mutableListOf<String>()
        val partsEn = mutableListOf<String>()

        if (emptyFolders) {
            partsAr.add("المجلدات الفارغة")
            partsEn.add("Empty folders")
        } else {
            if (kindAr.isNotEmpty()) {
                partsAr.add(kindAr)
                partsEn.add(kindEn)
            } else {
                partsAr.add("الملفات")
                partsEn.add("Files")
            }

            if (sizeAr.isNotEmpty()) {
                partsAr.add(sizeAr)
                partsEn.add(sizeEn)
            }

            if (ageAr.isNotEmpty()) {
                partsAr.add(ageAr)
                partsEn.add(ageEn)
            }
        }

        if (scopeAr.isNotEmpty()) {
            partsAr.add(scopeAr)
            partsEn.add(scopeEn)
        }

        val explanationAr = partsAr.joinToString(" · ")
        val explanationEn = partsEn.joinToString(" · ")

        return ParsedAiQuery(
            rawPrompt = prompt,
            recognizedIntent = intent,
            targetKind = targetKind,
            minSize = minSize,
            olderThanMs = olderThanMs,
            emptyFolders = emptyFolders,
            targetFolder = targetFolder,
            explanationAr = explanationAr,
            explanationEn = explanationEn,
            limit = limit,
        )
    }

    fun execute(context: Context, query: ParsedAiQuery): List<AiQueryResultItem> {
        val roots = listOfNotNull(
            Environment.getExternalStorageDirectory(),
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DCIM),
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS),
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES),
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES),
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC),
        ).filter { it.exists() && it.isDirectory }.distinctBy { it.absolutePath }

        val results = mutableListOf<AiQueryResultItem>()
        val visited = mutableSetOf<String>()

        for (root in roots) {
            val stack = mutableListOf(root)
            while (stack.isNotEmpty()) {
                val dir = stack.removeAt(stack.size - 1)
                val files = dir.listFiles() ?: continue

                for (f in files) {
                    if (f.isDirectory) {
                        if (query.emptyFolders) {
                            val inner = f.listFiles()
                            if (inner != null && inner.isEmpty() && visited.add(f.absolutePath)) {
                                if (query.targetFolder == null || f.absolutePath.contains(query.targetFolder, ignoreCase = true)) {
                                    results.add(
                                        AiQueryResultItem(
                                            file = f,
                                            name = f.name,
                                            path = f.absolutePath,
                                            size = 0L,
                                            lastModified = f.lastModified(),
                                            isDir = true,
                                            kind = "folder",
                                        )
                                    )
                                }
                            }
                        }
                        if (!f.name.startsWith(".") && f.name != "Android") {
                            stack.add(f)
                        }
                        continue
                    }

                    if (query.emptyFolders) continue
                    if (!visited.add(f.absolutePath)) continue

                    val size = f.length()
                    if (size < query.minSize) continue

                    val modified = f.lastModified()
                    if (query.olderThanMs != null && modified >= query.olderThanMs) continue

                    if (query.targetFolder != null && !f.absolutePath.contains(query.targetFolder, ignoreCase = true)) {
                        continue
                    }

                    val ext = f.extension.lowercase()
                    val kind = kindOf(ext)

                    if (query.targetKind != null && query.targetKind != kind) continue

                    results.add(
                        AiQueryResultItem(
                            file = f,
                            name = f.name,
                            path = f.absolutePath,
                            size = size,
                            lastModified = modified,
                            isDir = false,
                            kind = kind,
                        )
                    )
                }
            }
        }

        results.sortByDescending { it.size }
        return if (results.size > query.limit) results.subList(0, query.limit) else results
    }

    private fun kindOf(ext: String): String = when (ext) {
        "mp4", "mkv", "mov", "avi", "webm", "3gp", "flv" -> "video"
        "jpg", "jpeg", "png", "webp", "gif", "heic", "bmp" -> "image"
        "mp3", "wav", "m4a", "flac", "aac", "ogg" -> "audio"
        "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt" -> "document"
        "zip", "rar", "7z", "tar", "gz" -> "archive"
        "apk", "xapk", "apks" -> "installer"
        else -> "other"
    }
}
