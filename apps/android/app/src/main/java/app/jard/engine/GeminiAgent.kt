package app.jard.engine

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

data class ToolCall(
    val id: String,
    val name: String,
    val args: Map<String, Any>,
    val explanation: String
)

data class AgentResponse(
    val text: String,
    val toolCalls: List<ToolCall>
)

object GeminiAgent {

    private const val SYSTEM_INSTRUCTION = """
أنت «وكيل جَرد الذكي» (Jard Agent) على نظام أندرويد مع صلاحيات الروت (Root) وتكامل بيئة لينكس (Termux).
تتميز بالسرعة، الدقة، والأمان التام. تتحدث باللغة العربية بأسلوب واضح ومباشر.
قدراتك:
1. أوامر Termux: عند طلب تثبيت أو تشغيل أدوات برمجية (مثل Node.js أو Python أو Git أو تشغيل سيرفر ويب محلي)، استخدم أداة execute_termux_command لتشغيل أوامر مثل pkg install nodejs أو node server.js.
2. أوامر الروت (Root): لإدارة ملفات النظام، تنظيف كاش التطبيقات، أو فحص الذاكرة العميقة، استخدم execute_root_command.
3. إنشاء الملفات: عند طلب إنشاء موقع أو سكربت، استخدم create_file لكتابة ملفات كاملة (HTML, CSS, JS, Python).
4. استعراض الملفات: استخدم list_directory لمعاينة الملفات قبل تنظيمها أو نقلها.
قاعدة الأمان: اشرح دائماً بدقة ما يفعله الأمر، ولماذا تحتاجه.
"""

    private fun toolsJson(): JSONArray {
        val funcs = JSONArray()

        funcs.put(JSONObject().apply {
            put("name", "execute_termux_command")
            put("description", "تشغيل أمر داخل بيئة لينكس Termux (مثل: pkg install nodejs, node -v, تشغيل سيرفرات)")
            put("parameters", JSONObject().apply {
                put("type", "OBJECT")
                put("properties", JSONObject().apply {
                    put("command", JSONObject().put("type", "STRING").put("description", "الأمر المطلوب تشغيله في Termux"))
                    put("explanation", JSONObject().put("type", "STRING").put("description", "شرح بالعربية لما يقوم به هذا الأمر"))
                })
                put("required", JSONArray().put("command").put("explanation"))
            })
        })

        funcs.put(JSONObject().apply {
            put("name", "execute_root_command")
            put("description", "تشغيل أمر شل بصلاحية الروت الكاملة (su). يُستخدم لإدارة النظام والكاش والمسارات المقفلة.")
            put("parameters", JSONObject().apply {
                put("type", "OBJECT")
                put("properties", JSONObject().put("command", JSONObject().put("type", "STRING").put("description", "أمر الروت"))
                    .put("explanation", JSONObject().put("type", "STRING").put("description", "شرح وظيفة الأمر والمسارات التي يتعامل معها")))
                put("required", JSONArray().put("command").put("explanation"))
            })
        })

        funcs.put(JSONObject().apply {
            put("name", "create_file")
            put("description", "إنشاء أو كتابة ملف كود أو صفحة ويب على مساحة الهاتف (مثل /sdcard/www/index.html أو في مجلد Termux).")
            put("parameters", JSONObject().apply {
                put("type", "OBJECT")
                put("properties", JSONObject().apply {
                    put("path", JSONObject().put("type", "STRING").put("description", "المسار الكامل للملف"))
                    put("content", JSONObject().put("type", "STRING").put("description", "محتوى الملف"))
                    put("explanation", JSONObject().put("type", "STRING").put("description", "شرح لما يحتويه الملف"))
                })
                put("required", JSONArray().put("path").put("content").put("explanation"))
            })
        })

        funcs.put(JSONObject().apply {
            put("name", "list_directory")
            put("description", "استعراض محتويات مجلد على الهاتف لمعرفة ما بداخله.")
            put("parameters", JSONObject().apply {
                put("type", "OBJECT")
                put("properties", JSONObject().apply {
                    put("path", JSONObject().put("type", "STRING").put("description", "مسار المجلد المطلوب استعراضه"))
                })
                put("required", JSONArray().put("path"))
            })
        })

        return JSONArray().put(JSONObject().put("functionDeclarations", funcs))
    }

    suspend fun query(apiKey: String, history: List<Pair<String, String>>): Result<AgentResponse> = withContext(Dispatchers.IO) {
        runCatching {
            val url = URL("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey.trim()}")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json")
            conn.doOutput = true
            conn.connectTimeout = 15000
            conn.readTimeout = 30000

            val contentsArray = JSONArray()
            for ((role, text) in history) {
                contentsArray.put(JSONObject().apply {
                    put("role", if (role == "user") "user" else "model")
                    put("parts", JSONArray().put(JSONObject().put("text", text)))
                })
            }

            val requestBody = JSONObject().apply {
                put("system_instruction", JSONObject().put("parts", JSONArray().put(JSONObject().put("text", SYSTEM_INSTRUCTION))))
                put("contents", contentsArray)
                put("tools", toolsJson())
            }

            OutputStreamWriter(conn.outputStream).use { it.write(requestBody.toString()) }

            val code = conn.responseCode
            if (code != 200) {
                val errorStream = conn.errorStream?.let { BufferedReader(InputStreamReader(it)).readText() } ?: "HTTP $code"
                throw Exception("خطأ من Gemini ($code): $errorStream")
            }

            val responseText = BufferedReader(InputStreamReader(conn.inputStream)).readText()
            val json = JSONObject(responseText)
            val candidate = json.optJSONArray("candidates")?.optJSONObject(0)
                ?: throw Exception("لم يصل رد صالح من Gemini.")

            val parts = candidate.optJSONObject("content")?.optJSONArray("parts") ?: JSONArray()
            var text = ""
            val toolCalls = mutableListOf<ToolCall>()

            for (i in 0 until parts.length()) {
                val part = parts.getJSONObject(i)
                if (part.has("text")) {
                    text += part.getString("text")
                }
                if (part.has("functionCall")) {
                    val fc = part.getJSONObject("functionCall")
                    val name = fc.getString("name")
                    val argsObj = fc.optJSONObject("args") ?: JSONObject()
                    val argsMap = mutableMapOf<String, Any>()
                    val keys = argsObj.keys()
                    while (keys.hasNext()) {
                        val k = keys.next()
                        argsMap[k] = argsObj.get(k)
                    }
                    val explanation = argsMap["explanation"] as? String ?: "تشغيل $name"
                    toolCalls.add(ToolCall(
                        id = (1..6).map { ('a'..'z').random() }.joinToString(""),
                        name = name,
                        args = argsMap,
                        explanation = explanation
                    ))
                }
            }

            AgentResponse(text, toolCalls)
        }
    }
}
