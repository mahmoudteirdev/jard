package app.jard.ui

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.jard.design.Jard
import app.jard.design.JardMono
import app.jard.design.JardType
import app.jard.engine.GeminiAgent
import app.jard.engine.Privileged
import app.jard.engine.TermuxBridge
import app.jard.engine.ToolCall
import kotlinx.coroutines.launch
import java.io.File

data class ChatMessage(
    val id: String,
    val sender: String, // "user", "agent", "system"
    val text: String = "",
    val pendingTools: List<ToolCall> = emptyList(),
    val executedResults: List<Pair<String, Boolean>> = emptyList()
)

@Composable
fun AgentScreen(s: AppState) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var input by remember { mutableStateOf("") }
    var apiKeyInput by remember { mutableStateOf(s.geminiApiKey) }
    var loading by remember { mutableStateOf(false) }

    var messages by remember {
        mutableStateOf(
            listOf(
                ChatMessage(
                    id = "welcome",
                    sender = "agent",
                    text = "أهلاً بك! أنا وكيل جَرد الذكي على أندرويد. مع صلاحيات الروت وتكامل Termux، يمكنني تثبيت البرمجيات مثل Node.js، إنشاء المواقع وتشغيل خوادم محلية، أو فحص وترتيب الملفات المحمية. كل خطوة تتطلب موافقتك الصريحة قبل التنفيذ."
                )
            )
        )
    }

    val listState = rememberLazyListState()

    LaunchedEffect(messages.size, loading) {
        if (messages.isNotEmpty()) {
            listState.animateScrollToItem(messages.size - 1)
        }
    }

    fun executeTool(msgId: String, tool: ToolCall) {
        scope.launch {
            loading = true
            var output = ""
            var ok = true

            when (tool.name) {
                "execute_termux_command" -> {
                    val cmd = tool.args["command"] as? String ?: ""
                    val res = TermuxBridge.runInTermux(context, cmd)
                    ok = res.ok
                    output = res.out.ifBlank { if (ok) "تم التنفيذ بنجاح في Termux." else "فشل برمز ${res.code}" }
                }
                "execute_root_command" -> {
                    val cmd = tool.args["command"] as? String ?: ""
                    val res = Privileged.rootCommand(context, cmd)
                    ok = res.ok
                    output = res.out.ifBlank { if (ok) "تم تنفيذ أمر الروت بنجاح." else "فشل برمز ${res.code}" }
                }
                "create_file" -> {
                    val path = tool.args["path"] as? String ?: ""
                    val content = tool.args["content"] as? String ?: ""
                    try {
                        val file = File(path)
                        file.parentFile?.mkdirs()
                        file.writeText(content)
                        output = "تم إنشاء الملف بنجاح: $path"
                    } catch (e: Exception) {
                        ok = false
                        output = "فشل إنشاء الملف: ${e.message}"
                    }
                }
                "list_directory" -> {
                    val path = tool.args["path"] as? String ?: "/sdcard"
                    val res = Privileged.command(context, "ls -la '$path'")
                    output = res.out.ifBlank { "مجلد فارغ أو لا يمكن قراءته." }
                    ok = res.ok
                }
                else -> {
                    ok = false
                    output = "أداة غير مدعومة: ${tool.name}"
                }
            }

            // Update message state
            messages = messages.map { m ->
                if (m.id == msgId) {
                    m.copy(
                        pendingTools = m.pendingTools.filter { it.id != tool.id },
                        executedResults = m.executedResults + (output to ok)
                    )
                } else m
            }

            // Feed tool result back to Gemini
            if (s.geminiApiKey.isNotBlank()) {
                val history = messages.filter { it.text.isNotBlank() }.takeLast(6).map { (it.sender to it.text) } +
                        ("user" to "النتيجة من تشغيل ${tool.name}:\n$output")
                val next = GeminiAgent.query(s.geminiApiKey, history)
                next.onSuccess { res ->
                    messages = messages + ChatMessage(
                        id = (1..6).map { ('a'..'z').random() }.joinToString(""),
                        sender = "agent",
                        text = res.text,
                        pendingTools = res.toolCalls
                    )
                }.onFailure { err ->
                    messages = messages + ChatMessage(
                        id = (1..6).map { ('a'..'z').random() }.joinToString(""),
                        sender = "system",
                        text = "خطأ: ${err.message}"
                    )
                }
            }
            loading = false
        }
    }

    fun rejectTool(msgId: String, tool: ToolCall) {
        messages = messages.map { m ->
            if (m.id == msgId) {
                m.copy(
                    pendingTools = m.pendingTools.filter { it.id != tool.id },
                    executedResults = m.executedResults + ("تم رفض تشغيل الخطوة بواسطة المستخدم." to false)
                )
            } else m
        }
    }

    fun send(promptText: String) {
        val q = promptText.trim()
        if (q.isBlank() || loading) return
        if (s.geminiApiKey.isBlank()) {
            messages = messages + ChatMessage(
                id = (1..6).map { ('a'..'z').random() }.joinToString(""),
                sender = "system",
                text = "يرجى حفظ مفتاح Gemini API أولاً للبدء."
            )
            return
        }

        messages = messages + ChatMessage(
            id = (1..6).map { ('a'..'z').random() }.joinToString(""),
            sender = "user",
            text = q
        )
        input = ""
        loading = true

        scope.launch {
            val history = messages.filter { it.text.isNotBlank() }.takeLast(6).map { (it.sender to it.text) }
            val res = GeminiAgent.query(s.geminiApiKey, history)
            res.onSuccess { resp ->
                messages = messages + ChatMessage(
                    id = (1..6).map { ('a'..'z').random() }.joinToString(""),
                    sender = "agent",
                    text = resp.text,
                    pendingTools = resp.toolCalls
                )
            }.onFailure { err ->
                messages = messages + ChatMessage(
                    id = (1..6).map { ('a'..'z').random() }.joinToString(""),
                    sender = "system",
                    text = "خطأ من الوكيل: ${err.message}"
                )
            }
            loading = false
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(Jard.colors.surfaceBase)
            .padding(16.dp)
    ) {
        // Top Header
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                T("الوكيل الذكي · Jard Agent", style = JardType.title)
                T("مدعوم بـ Google Gemini + Root + Termux", style = JardType.label, color = Jard.colors.inkQuiet)
            }
            Btn("إغلاق", { s.page = Page.None })
        }

        Spacer(Modifier.height(10.dp))

        // API Key configuration card if missing
        if (s.geminiApiKey.isBlank()) {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp)) {
                    T("مفتاح Google Gemini مطلوب", style = JardType.heading)
                    T("احصل على مفتاح مجاني فوراً من Google AI Studio والصقه هنا:", style = JardType.caption, color = Jard.colors.inkQuiet)
                    Spacer(Modifier.height(8.dp))
                    BasicTextField(
                        value = apiKeyInput,
                        onValueChange = { apiKeyInput = it },
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Jard.colors.surfaceRaised)
                            .border(1.dp, Jard.colors.line)
                            .padding(8.dp),
                        textStyle = TextStyle(color = Jard.colors.ink, fontSize = 13.sp, fontFamily = JardMono),
                        cursorBrush = SolidColor(Jard.colors.ink)
                    )
                    Spacer(Modifier.height(8.dp))
                    Btn("حفظ المفتاح", { s.saveGeminiApiKey(apiKeyInput) }, kind = BtnKind.Primary)
                }
            }
            Spacer(Modifier.height(10.dp))
        }

        // Quick prompts chips
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Btn("⚡ تثبيت Node بـ Termux", { send("تحقق هل Node.js مثبت في Termux، وثبته إذا لم يكن موجوداً") }, modifier = Modifier.weight(1f))
            Btn("🌐 إنشاء موقع محلي", { send("أنشئ صفحة ويب بسيطة وشغّل سيرفر محلي عليها") }, modifier = Modifier.weight(1f))
        }

        Spacer(Modifier.height(10.dp))

        // Chat conversation log
        LazyColumn(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .background(Jard.colors.surfaceRaised)
                .border(1.dp, Jard.colors.line)
                .padding(10.dp),
            state = listState,
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            items(messages, key = { it.id }) { msg ->
                val isUser = msg.sender == "user"
                val isSystem = msg.sender == "system"

                Column(
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 4.dp),
                    horizontalAlignment = if (isUser) Alignment.End else Alignment.Start
                ) {
                    Box(
                        Modifier
                            .widthIn(max = 320.dp)
                            .background(if (isUser) Jard.colors.surfaceSelected else Jard.colors.surfaceBase)
                            .border(1.dp, if (isSystem) Jard.colors.statusWarn else Jard.colors.line)
                            .padding(10.dp)
                    ) {
                        Column {
                            if (!isUser) {
                                T(
                                    if (isSystem) "تنبيه" else "جَرد Agent",
                                    style = JardType.label,
                                    color = Jard.colors.accent,
                                    modifier = Modifier.padding(bottom = 4.dp)
                                )
                            }
                            if (msg.text.isNotBlank()) {
                                T(msg.text, style = JardType.body)
                            }

                            // Pending Tool Execution Card
                            msg.pendingTools.forEach { tool ->
                                Spacer(Modifier.height(8.dp))
                                Column(
                                    Modifier
                                        .fillMaxWidth()
                                        .background(Color.Black.copy(alpha = 0.3f))
                                        .border(1.dp, Jard.colors.accent)
                                        .padding(8.dp)
                                ) {
                                    val isRoot = tool.name == "execute_root_command"
                                    val isTermux = tool.name == "execute_termux_command"
                                    T(
                                        if (isRoot) "⚡ أمر Superuser (Root)" else if (isTermux) "🐧 أمر Termux Linux" else "ملف",
                                        style = JardType.heading,
                                        color = if (isRoot) Jard.colors.statusWarn else Jard.colors.accent
                                    )
                                    T(tool.explanation, style = JardType.caption, color = Jard.colors.inkQuiet)
                                    Spacer(Modifier.height(4.dp))
                                    val cmd = (tool.args["command"] ?: tool.args["path"] ?: tool.name).toString()
                                    Box(
                                        Modifier
                                            .fillMaxWidth()
                                            .background(Color.Black)
                                            .padding(6.dp)
                                    ) {
                                        BasicText(cmd, style = TextStyle(color = Color(0xFF4FCBA0), fontSize = 12.sp, fontFamily = JardMono))
                                    }
                                    Spacer(Modifier.height(6.dp))
                                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        Btn("موافق وتنفيذ ✓", { executeTool(msg.id, tool) }, kind = BtnKind.Primary)
                                        Btn("إلغاء ✕", { rejectTool(msg.id, tool) })
                                    }
                                }
                            }

                            // Executed results log
                            msg.executedResults.forEach { (res, ok) ->
                                Spacer(Modifier.height(4.dp))
                                T(
                                    (if (ok) "✓ " else "✕ ") + res,
                                    style = JardType.caption,
                                    color = if (ok) Jard.colors.accent else Jard.colors.statusWarn
                                )
                            }
                        }
                    }
                }
            }
            if (loading) {
                item {
                    T("الوكيل يفكر ويكتب الرد…", style = JardType.caption, color = Jard.colors.inkQuiet)
                }
            }
        }

        Spacer(Modifier.height(10.dp))

        // Input bar
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            BasicTextField(
                value = input,
                onValueChange = { input = it },
                modifier = Modifier
                    .weight(1f)
                    .background(Jard.colors.surfaceRaised)
                .border(1.dp, Jard.colors.line)
                    .padding(12.dp),
                textStyle = TextStyle(color = Jard.colors.ink, fontSize = 14.sp),
                cursorBrush = SolidColor(Jard.colors.ink),
                enabled = !loading
            )
            Btn("إرسال", { send(input) }, kind = BtnKind.Primary, enabled = !loading && input.isNotBlank())
        }
    }
}
