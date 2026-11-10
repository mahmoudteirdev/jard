package app.jard.ui

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

/**
 * Arabic text in the code is the key, as on the desktop: a missing English falls back to Arabic rather
 * than a blank. `{}` in a key stands for what's filled in at run time. `scripts/i18n.mjs` checks
 * that every string has its English.
 */
object I18n {
    var english by mutableStateOf(false)
        private set

    /** "auto" (follows device), "ar", or "en". */
    var preference by mutableStateOf("auto")
        private set

    private var exact: Map<String, String> = emptyMap()
    private var templates: List<Pair<Regex, String>> = emptyList()
    private val cache = ConcurrentHashMap<String, String>()
    private var loaded = false

    fun isSystemEnglish(context: Context): Boolean {
        val loc = if (android.os.Build.VERSION.SDK_INT >= 24) {
            context.resources.configuration.locales.get(0)
        } else {
            @Suppress("DEPRECATION")
            context.resources.configuration.locale
        } ?: java.util.Locale.getDefault()
        val lang = loc.language.lowercase()
        return !lang.startsWith("ar")
    }

    fun init(context: Context) {
        val prefs = context.getSharedPreferences("jard", Context.MODE_PRIVATE)
        val saved = prefs.getString("language", "auto") ?: "auto"
        preference = saved
        val useEn = when (saved) {
            "en" -> true
            "ar" -> false
            else -> isSystemEnglish(context)
        }
        applyLanguage(context, useEn)
    }

    fun setPreference(context: Context, pref: String) {
        preference = pref
        context.getSharedPreferences("jard", Context.MODE_PRIVATE).edit().putString("language", pref).apply()
        val useEn = when (pref) {
            "en" -> true
            "ar" -> false
            else -> isSystemEnglish(context)
        }
        applyLanguage(context, useEn)
    }

    fun setLanguage(context: Context, en: Boolean) {
        setPreference(context, if (en) "en" else "ar")
    }

    private fun applyLanguage(context: Context, en: Boolean) {
        if (en && !loaded) load(runCatching { context.assets.open("en.json").bufferedReader().use { it.readText() } }.getOrDefault("{}"))
        english = en
    }

    internal fun load(json: String) {
        val o = JSONObject(json)
        val whole = HashMap<String, String>()
        val filled = ArrayList<Pair<Regex, String>>()
        for (k in o.keys()) {
            val v = o.getString(k)
            if ("{}" in k) {
                val pattern = k.split("{}").joinToString("(.*?)", "^", "$") { Regex.escape(it) }
                filled.add(Regex(pattern, RegexOption.DOT_MATCHES_ALL) to v)
            } else {
                whole[k] = v
            }
        }
        exact = whole
        // The longest key first: a more specific sentence wins over one that merely fits.
        templates = filled.sortedByDescending { it.first.pattern.length }
        cache.clear()
        loaded = true
    }

    internal fun useEnglishForTest(json: String) {
        load(json)
        english = true
    }

    internal fun hasArabic(s: String) = s.any { it in '؀'..'ۿ' }

    /** The text for the current language. Anything without Arabic, like a file name, goes straight through. */
    fun tr(text: String): String {
        if (!english || !hasArabic(text)) return text
        return cache.getOrPut(text) {
            exact[text] ?: templates.firstNotNullOfOrNull { (re, value) ->
                re.matchEntire(text)?.let { m ->
                    var out = value
                    for (g in m.groupValues.drop(1)) out = out.replaceFirst("{}", tr(g))
                    out
                }
            } ?: text
        }
    }

    /** For a sentence built here: `{}` filled in order, in either language. */
    fun tr(template: String, vararg args: String): String {
        var out = if (english) exact[template] ?: template else template
        for (a in args) out = out.replaceFirst("{}", a)
        return out
    }
}
