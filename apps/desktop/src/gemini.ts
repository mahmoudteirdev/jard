// Google Gemini 2.0 Flash client with tool execution & human-in-the-loop approvals.

export interface GeminiMessage {
  role: "user" | "model";
  parts: GeminiPart[];
}

export type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, any> } }
  | { functionResponse: { name: string; response: Record<string, any> } };

export interface PendingToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
  explanation: string;
}

const SYSTEM_INSTRUCTION = `أنت «وكيل جَرد الذكي» (Jard AI Agent)، مساعد متقدم لإدارة الملفات، مشاريع البرمجة، وتنظيم القرص.
تتميز بالسرعة والشفافية. تتحدث باللغة العربية (أو باللغة التي يكلمك بها المستخدم).
قواعد العمل:
1. تنظيم الملفات: عند طلب ترتيب مجلد (مثل التنزيلات Downloads)، افحص المجلد أولاً بأداة list_directory، ثم استخدم move_file لنقل الملفات إلى تصنيفات واضحة (مستندات، صور، فيديو، برامج...).
2. مشاريع الويب: عند طلب موقع أو صفحة خفيفة، اختر مساراً مناسباً (مثل مجلد داخل Desktop أو المستندات) واستخدم create_file لكتابة ملفات متكاملة ونظيفة (HTML, CSS, JS).
3. سطر الأوامر: عند طلب فحص أو تثبيت Node.js أو بايثون أو غيرها، استخدم execute_command لتشغيل أوامر مثل node -v أو تثبيتها عبر winget.
4. اذكر دائماً شرحاً موجزاً ومطمئناً للخطوة.`;

const TOOLS_DECLARATION = [
  {
    functionDeclarations: [
      {
        name: "execute_command",
        description: "تشغيل أمر في سطر الأوامر (PowerShell على ويندوز). مثل: فحص البرامج، تثبيت أدوات عبر winget، تشغيل سيرفرات.",
        parameters: {
          type: "OBJECT",
          properties: {
            command: { type: "STRING", description: "الأمر المطلوب تشغيله بدقة" },
            explanation: { type: "STRING", description: "شرح بالعربية لما يقوم به هذا الأمر ولماذا يتم تشغيله" },
            is_dangerous: { type: "BOOLEAN", description: "هل الأمر يغير أو يحذف ملفات في النظام؟" },
          },
          required: ["command", "explanation"],
        },
      },
      {
        name: "create_file",
        description: "إنشاء أو كتابة ملف كود أو نص في مسار محدد على الجهاز (مثل إنشاء صفحة ويب HTML/CSS/JS).",
        parameters: {
          type: "OBJECT",
          properties: {
            path: { type: "STRING", description: "المسار الكامل أو النسبي للملف" },
            content: { type: "STRING", description: "المحتوى الكامل للملف" },
            explanation: { type: "STRING", description: "شرح لما يحتويه هذا الملف" },
          },
          required: ["path", "content", "explanation"],
        },
      },
      {
        name: "read_file",
        description: "قراءة محتوى ملف نصي على الجهاز لمعاينته أو تعديله.",
        parameters: {
          type: "OBJECT",
          properties: {
            path: { type: "STRING", description: "المسار الكامل للملف المطلوب قراءته" },
          },
          required: ["path"],
        },
      },
      {
        name: "list_directory",
        description: "استعراض محتويات مجلد على الجهاز لمعرفة الملفات والمجلدات الموجودة داخله وحجومها.",
        parameters: {
          type: "OBJECT",
          properties: {
            path: { type: "STRING", description: "مسار المجلد (اتركه فارغاً للمجلد الرئيسي للمستخدم)" },
          },
        },
      },
      {
        name: "move_file",
        description: "نقل ملف من مكان إلى مكان آخر (يُستخدم لترتيب الملفات وتنظيمها).",
        parameters: {
          type: "OBJECT",
          properties: {
            from: { type: "STRING", description: "مسار الملف الأصلي" },
            to: { type: "STRING", description: "المسار الجديد المراد نقل الملف إليه" },
            explanation: { type: "STRING", description: "سبب النقل (مثلاً: نقل إلى مجلد المستندات)" },
          },
          required: ["from", "to", "explanation"],
        },
      },
    ],
  },
];

export async function callGemini(
  apiKey: string,
  history: GeminiMessage[],
): Promise<{ text: string; toolCalls: PendingToolCall[] }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey.trim()}`;

  const body = {
    system_instruction: {
      parts: [{ text: SYSTEM_INSTRUCTION }],
    },
    contents: history,
    tools: TOOLS_DECLARATION,
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 2048,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`خطأ من Gemini (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const candidate = data.candidates?.[0];
  if (!candidate) {
    throw new Error("لم يصل رد صالح من Gemini.");
  }

  let text = "";
  const toolCalls: PendingToolCall[] = [];

  for (const part of candidate.content?.parts || []) {
    if (part.text) {
      text += part.text;
    }
    if (part.functionCall) {
      const fc = part.functionCall;
      toolCalls.push({
        id: Math.random().toString(36).substring(2, 9),
        name: fc.name,
        args: fc.args || {},
        explanation: (fc.args?.explanation as string) || `استدعاء ${fc.name}`,
      });
    }
  }

  return { text, toolCalls };
}
