package app.jard.engine

enum class Safety(val word: String) {
    Safe("آمن"),
    Mostly("آمن غالباً"),
    Check("راجعه أولاً"),
    Keep("لا تحذفه"),
    Unknown("غير معروف"),
}

data class Explanation(val safety: Safety, val what: String, val ifDeleted: String)

/** A plain answer to "what is this?". When we don't recognise something, we say so instead of guessing. */
object Explain {
    private val NAMES: Map<String, Explanation> = mapOf(
        ".thumbnails" to Explanation(Safety.Safe, "نسخ صغيرة من صورك يعرضها المعرض بسرعة. ليست صورك الأصلية.", "يعيد الهاتف إنشاءها مع الوقت. صورك الأصلية لا تتأثر."),
        "obb" to Explanation(Safety.Keep, "ملفات الألعاب والتطبيقات الكبيرة، مثل الخرائط والأصوات.", "قد تتوقف الألعاب عن العمل، أو تعيد تنزيل كل بياناتها."),
        "lost.dir" to Explanation(Safety.Check, "أجزاء ملفات استرجعها أندرويد بعد إخراج ذاكرة بشكل خاطئ.", "لا يؤثر على النظام، لكن قد يكون فيه شيء تحتاجه."),
        ".trash" to Explanation(Safety.Check, "سلة مهملات أحد التطبيقات. ملفات حذفتها وما زالت تأخذ مساحة.", "تختفي نهائياً ولا ترجع من التطبيق نفسه."),
        "dcim" to Explanation(Safety.Keep, "صور وفيديوهات الكاميرا الأصلية.", "تفقد صورك. انقل ما بدك منها، ولا تحذف المجلد كله."),
        "download" to Explanation(Safety.Check, "ما نزّلته من المتصفح والتطبيقات.", "الملفات المحذوفة لازم تنزّلها من جديد إذا احتجتها."),
        "android" to Explanation(Safety.Keep, "بيانات التطبيقات في التخزين المشترك.", "التطبيقات قد تفقد بياناتها أو تتوقف."),
        "telegram" to Explanation(Safety.Check, "الملفات اللي نزّلها تيليجرام. معظمها قابل للتنزيل من جديد ما دامت الرسالة موجودة.", "تختفي من الهاتف، وتقدر غالباً تنزلها من المحادثة."),
        "whatsapp" to Explanation(Safety.Check, "صور وفيديوهات ومستندات واتساب.", "تختفي من الهاتف، وما بترجع إلا من نسخة احتياطية."),
        "movies" to Explanation(Safety.Check, "فيديوهات حفظتها أنت أو تطبيقاتك.", "تفقدها إذا ما عندك نسخة ثانية."),
        "pictures" to Explanation(Safety.Check, "صور حفظتها التطبيقات، ولقطات الشاشة غالباً.", "تفقدها إذا ما عندك نسخة ثانية."),
        "music" to Explanation(Safety.Check, "ملفات صوت على هاتفك.", "تفقدها إذا ما عندك نسخة ثانية."),
        "documents" to Explanation(Safety.Check, "مستندات حفظتها أنت أو تطبيقاتك.", "تفقدها إذا ما عندك نسخة ثانية."),
        "cache" to Explanation(Safety.Safe, "ملفات مؤقتة يحتفظ بها تطبيق ليفتح أسرع.", "يعيد التطبيق إنشاءها، وأول فتح يكون أبطأ."),
        ".cache" to Explanation(Safety.Safe, "ملفات مؤقتة يحتفظ بها تطبيق ليفتح أسرع.", "يعيد التطبيق إنشاءها، وأول فتح يكون أبطأ."),
        "backups" to Explanation(Safety.Keep, "نسخ احتياطية من تطبيق أو من الهاتف.", "قد تفقد قدرتك على استرجاع بياناتك."),
    )

    private val KINDS = mapOf(
        FileKind.Video to Explanation(Safety.Check, "ملف فيديو.", "يختفي من هاتفك. تأكد إن عندك نسخة إذا كان مهماً."),
        FileKind.Image to Explanation(Safety.Check, "صورة.", "تختفي من هاتفك. تأكد إن عندك نسخة إذا كانت مهمة."),
        FileKind.Audio to Explanation(Safety.Check, "ملف صوت.", "يختفي من هاتفك."),
        FileKind.Document to Explanation(Safety.Check, "مستند.", "يختفي من هاتفك. افتحه أولاً إذا مش متأكد."),
    )

    fun of(n: FileNode): Explanation {
        val lower = n.name.lowercase()
        NAMES[lower]?.let { return it }
        if (lower.startsWith(".trash")) return NAMES.getValue(".trash")
        if (!n.isDir) {
            if (lower.endsWith(".apk") || lower.endsWith(".xapk")) {
                return Explanation(Safety.Mostly, "ملف تثبيت تطبيق. بعد التثبيت ما عاد إله لزوم.", "التطبيق المثبت يبقى شغالاً. تحتاج تنزيله من جديد لتثبيته مرة ثانية.")
            }
            if (lower.endsWith(".zip") || lower.endsWith(".rar") || lower.endsWith(".7z") || lower.endsWith(".iso")) {
                return Explanation(Safety.Check, "أرشيف أو صورة قرص. غالباً نسخة مضغوطة من ملفات أخرى.", "إذا فككته وما بتحتاجه، ما بتفقد شي.")
            }
            KINDS[FileKind.of(n.name)]?.let { return it }
        }
        return Explanation(Safety.Unknown, "ما بنعرف شو هذا بالتحديد، وما بدنا نخمّن.", "إذا كان تابع لتطبيق، ممكن يتأثر. الحجر المؤقت بيخليك تجرب وترجعه خلال 30 يوماً.")
    }
}

/** Things a person could clear without thinking long, for "clean the phone". Nothing is pre-selected. */
object Suggestions {
    private const val SIX_MONTHS = 182L * 86_400
    private const val YEAR = 365L * 86_400

    data class Item(val node: FileNode, val why: String)

    fun of(tree: ScanTree, now: Long = System.currentTimeMillis() / 1000): List<Item> {
        val out = ArrayList<Item>()
        val attached = HashSet<Int>().apply {
            val stack = ArrayDeque<Int>()
            stack.addLast(0)
            while (stack.isNotEmpty()) {
                val id = stack.removeLast()
                add(id)
                tree.nodes[id].children.forEach(stack::addLast)
            }
        }
        for (n in tree.nodes) {
            if (n.id !in attached || n.parent < 0 || protectedReason(tree, n) != null) continue
            val lower = n.name.lowercase()
            when {
                n.isDir && lower == ".thumbnails" && n.onDisk > 1_000_000 -> out.add(Item(n, "نسخ مصغّرة، يعيد الهاتف إنشاءها."))
                n.isDir && lower.startsWith(".trash") && n.onDisk > 0 -> out.add(Item(n, "ملفات حذفتها وما زالت تأخذ مساحة."))
                !n.isDir && (lower.endsWith(".apk") || lower.endsWith(".xapk")) && n.onDisk > 1_000_000 -> out.add(Item(n, "ملف تثبيت. التطبيق المثبت ما بيتأثر."))
                !n.isDir && inDownloads(tree, n) && n.modified in 1 until now - SIX_MONTHS && n.onDisk > 1_000_000 -> out.add(Item(n, "في التنزيلات ولم يتغير من أكثر من 6 أشهر."))
                !n.isDir && n.onDisk > 100_000_000 && n.modified in 1 until now - YEAR -> out.add(Item(n, "كبير ولم يتغير من أكثر من سنة."))
            }
        }
        return out.sortedByDescending { it.node.onDisk }
    }

    private fun inDownloads(tree: ScanTree, n: FileNode): Boolean {
        var cur = n.parent
        while (cur >= 0) {
            if (tree.nodes[cur].name.equals("download", ignoreCase = true)) return true
            cur = tree.nodes[cur].parent
        }
        return false
    }
}
