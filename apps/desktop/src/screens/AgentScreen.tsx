import { useState, useRef, useEffect } from "react";
import { engine } from "../engine";
import { useSettings, updateSettings } from "../settings";
import { callGemini, type GeminiMessage, type PendingToolCall } from "../gemini";

interface ChatItem {
  id: string;
  sender: "user" | "agent" | "system";
  text?: string;
  pendingTools?: PendingToolCall[];
  executedTools?: { name: string; args: any; result: string; ok: boolean }[];
}

export function AgentScreen() {
  const { geminiApiKey } = useSettings();
  const [apiKeyInput, setApiKeyInput] = useState(geminiApiKey || "");
  const [messages, setMessages] = useState<ChatItem[]>(() => [
    {
      id: "welcome",
      sender: "agent",
      text: "أهلاً بك! أنا وكيل جَرد الذكي (Jard Agent). يمكنني مساعدتك في تنظيم ملفات جهازك، تثبيت البرامج وتجهيز بيئة التطوير مثل Node.js، أو إنشاء مشاريع ومواقع ويب خفيفة. كل خطوة تتطلب موافقتك الصريحة قبل التنفيذ.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleSaveKey = () => {
    updateSettings({ geminiApiKey: apiKeyInput.trim() });
  };

  const executeTool = async (call: PendingToolCall) => {
    try {
      let resultText = "";
      let ok = true;

      if (call.name === "execute_command") {
        const cmd = call.args.command as string;
        const out = await engine.runAgentCommand(cmd);
        ok = out.exitCode === 0;
        resultText = out.stdout || out.stderr || (ok ? "تم تنفيذ الأمر بنجاح." : `فشل الأمر برمز: ${out.exitCode}`);
      } else if (call.name === "create_file") {
        const path = call.args.path as string;
        const content = call.args.content as string;
        await engine.writeAgentFile(path, content);
        resultText = `تم إنشاء الملف بنجاح: ${path}`;
      } else if (call.name === "read_file") {
        const path = call.args.path as string;
        resultText = await engine.readAgentFile(path);
      } else if (call.name === "list_directory") {
        const path = (call.args.path as string) || "";
        const list = await engine.listAgentDir(path);
        resultText = list.map((e) => `${e.isDir ? "[مجلد]" : "[ملف]"} ${e.name} (${Math.round(e.size / 1024)} KB)`).join("\n");
      } else if (call.name === "move_file") {
        const from = call.args.from as string;
        const to = call.args.to as string;
        await engine.moveAgentFile(from, to);
        resultText = `تم نقل الملف بنجاح من ${from} إلى ${to}`;
      } else {
        throw new Error(`أداة غير معروفة: ${call.name}`);
      }

      // Record tool execution and update messages
      setMessages((prev) =>
        prev.map((msg) => {
          if (!msg.pendingTools?.some((t) => t.id === call.id)) return msg;
          const remaining = msg.pendingTools.filter((t) => t.id !== call.id);
          const executed = [...(msg.executedTools || []), { name: call.name, args: call.args, result: resultText, ok }];
          return { ...msg, pendingTools: remaining, executedTools: executed };
        }),
      );

      // Send result back to Gemini so it can continue reasoning
      if (geminiApiKey) {
        setLoading(true);
        const history: GeminiMessage[] = [
          { role: "user", parts: [{ text: `النتيجة من تنفيذ ${call.name}:\n${resultText}` }] },
        ];
        const res = await callGemini(geminiApiKey, history);
        setMessages((prev) => [
          ...prev,
          {
            id: Math.random().toString(36).substring(2, 9),
            sender: "agent",
            text: res.text,
            pendingTools: res.toolCalls.length ? res.toolCalls : undefined,
          },
        ]);
        setLoading(false);
      }
    } catch (e: any) {
      setMessages((prev) =>
        prev.map((msg) => {
          if (!msg.pendingTools?.some((t) => t.id === call.id)) return msg;
          const remaining = msg.pendingTools.filter((t) => t.id !== call.id);
          const executed = [...(msg.executedTools || []), { name: call.name, args: call.args, result: String(e.message || e), ok: false }];
          return { ...msg, pendingTools: remaining, executedTools: executed };
        }),
      );
      setLoading(false);
    }
  };

  const rejectTool = (call: PendingToolCall) => {
    setMessages((prev) =>
      prev.map((msg) => {
        if (!msg.pendingTools?.some((t) => t.id === call.id)) return msg;
        return {
          ...msg,
          pendingTools: msg.pendingTools.filter((t) => t.id !== call.id),
          executedTools: [...(msg.executedTools || []), { name: call.name, args: call.args, result: "تم رفض التنفيذ بواسطة المستخدم.", ok: false }],
        };
      }),
    );
  };

  const sendMessage = async (customPrompt?: string) => {
    const textToSend = customPrompt || input.trim();
    if (!textToSend || loading) return;

    if (!geminiApiKey) {
      setMessages((prev) => [
        ...prev,
        { id: Math.random().toString(), sender: "system", text: "يرجى إدخال مفتاح Gemini API أولاً لتتمكن من استخدام الوكيل." },
      ]);
      return;
    }

    const userMsg: ChatItem = { id: Math.random().toString(36).substring(2, 9), sender: "user", text: textToSend };
    setMessages((prev) => [...prev, userMsg]);
    if (!customPrompt) setInput("");
    setLoading(true);

    try {
      const history: GeminiMessage[] = messages
        .filter((m) => m.text)
        .slice(-8)
        .map((m) => ({
          role: m.sender === "user" ? "user" : "model",
          parts: [{ text: m.text! }],
        }));
      history.push({ role: "user", parts: [{ text: textToSend }] });

      const res = await callGemini(geminiApiKey, history);

      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(36).substring(2, 9),
          sender: "agent",
          text: res.text,
          pendingTools: res.toolCalls.length ? res.toolCalls : undefined,
        },
      ]);
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        { id: Math.random().toString(), sender: "system", text: `خطأ: ${e.message || e}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="agent-container" style={{ display: "flex", flexDirection: "column", height: "100%", gap: 16 }}>
      {/* Header */}
      <header className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="name">الوكيل الذكي · Jard Agent</h1>
          <p className="muted small">مدعوم بـ Google Gemini 2.0 Flash لتنفيذ الأوامر، تنظيم الملفات، وإنشاء المشاريع بأمان.</p>
        </div>
      </header>

      {/* API Key Banner if not set */}
      {!geminiApiKey ? (
        <section className="card" style={{ padding: 16, border: "1px solid var(--accent)", background: "var(--surface-raised)" }}>
          <h2 style={{ fontSize: 16, margin: "0 0 8px 0" }}>مفتاح Google Gemini API مطلوب</h2>
          <p className="muted small" style={{ margin: "0 0 12px 0" }}>
            مفتاح Gemini مجاني بالكامل من Google AI Studio ويستغرق استخراجه ثوانٍ معدودة. يتم حفظ المفتاح محلياً على جهازك فقط.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              type="password"
              placeholder="ألصق مفتاح AI Studio هنا (AIzaSy...)"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              style={{ flex: "1 1 280px", padding: "8px 12px", background: "var(--surface)", border: "1px solid var(--line)" }}
            />
            <button type="button" className="btn btn-primary" onClick={handleSaveKey}>
              حفظ المفتاح
            </button>
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noreferrer"
              className="btn"
              style={{ textDecoration: "none" }}
            >
              احصل على مفتاح مجاني ↗
            </a>
          </div>
        </section>
      ) : null}

      {/* Quick Prompts Chips */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="preset-btn"
          onClick={() => sendMessage("افحص هل Node.js و Git مثبتان على جهازي، وأخبرني بالإصدارات")}
        >
          ⚡ فحص أدوات Node و Git
        </button>
        <button
          type="button"
          className="preset-btn"
          onClick={() => sendMessage("اصنع لي موقع ويب بسيط (صفحة هبوط مع عداد تفاعلي) في مجلد جديد على سطح المكتب")}
        >
          🌐 إنشاء صفحة ويب تجريبية
        </button>
        <button
          type="button"
          className="preset-btn"
          onClick={() => sendMessage("استعرض لي محتويات مجلد التنزيلات واقترح خطة لترتيبها")}
        >
          📁 ترتيب مجلد التنزيلات
        </button>
      </div>

      {/* Chat Messages Log */}
      <div
        className="card"
        style={{
          flex: "1 1 0",
          overflowY: "auto",
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          minHeight: 240,
        }}
      >
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              alignSelf: m.sender === "user" ? "flex-end" : "flex-start",
              maxWidth: "85%",
              background: m.sender === "user" ? "var(--surface-selected)" : "var(--surface-raised)",
              border: `1px solid ${m.sender === "system" ? "var(--warn)" : "var(--line)"}`,
              padding: 12,
              borderRadius: 2,
            }}
          >
            {m.sender !== "user" && (
              <strong style={{ display: "block", fontSize: 13, marginBottom: 4, color: "var(--accent)" }}>
                {m.sender === "agent" ? "جَرد Agent" : "تنبيه النظام"}
              </strong>
            )}
            {m.text && <p style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{m.text}</p>}

            {/* Pending Tool Approvals */}
            {m.pendingTools && m.pendingTools.length > 0 && (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                <span className="small muted">خطوة بانتظار موافقتك للتنفيذ:</span>
                {m.pendingTools.map((t) => (
                  <div
                    key={t.id}
                    style={{
                      padding: 10,
                      background: "rgba(0,0,0,0.3)",
                      borderInlineStart: "4px solid var(--accent)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    <strong>{t.explanation}</strong>
                    <code style={{ fontSize: 12, background: "#000", padding: "4px 8px", color: "#4FCBA0" }}>
                      {t.name === "execute_command"
                        ? t.args.command
                        : t.name === "create_file"
                        ? `إنشاء: ${t.args.path}`
                        : t.name === "move_file"
                        ? `نقل: ${t.args.from} ➔ ${t.args.to}`
                        : `${t.name}(${JSON.stringify(t.args)})`}
                    </code>
                    <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                      <button type="button" className="btn btn-primary" onClick={() => executeTool(t)}>
                        موافق وتطبيق الخطوة ✓
                      </button>
                      <button type="button" className="btn" onClick={() => rejectTool(t)}>
                        إلغاء ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Executed Tools Feedback */}
            {m.executedTools && m.executedTools.length > 0 && (
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                {m.executedTools.map((e, idx) => (
                  <div key={idx} className="small" style={{ color: e.ok ? "var(--data-1)" : "var(--warn)" }}>
                    {e.ok ? "✓ " : "✕ "}
                    {e.result}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {loading && <p className="muted small" role="status">الوكيل يفكر ويكتب الرد…</p>}
        <div ref={scrollRef} />
      </div>

      {/* Input Bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage();
        }}
        style={{ display: "flex", gap: 8 }}
      >
        <input
          type="text"
          placeholder="اكتب طلبك للوكيل (مثلاً: افحص بيئة نود، رتّب مجلداً، أنشئ موقعاً)..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading || !geminiApiKey}
          style={{
            flex: "1 1 0",
            padding: "10px 14px",
            background: "var(--surface-raised)",
            border: "1px solid var(--line)",
            fontSize: 14,
          }}
        />
        <button type="submit" className="btn btn-primary" disabled={loading || !geminiApiKey || !input.trim()}>
          إرسال
        </button>
      </form>
    </div>
  );
}
