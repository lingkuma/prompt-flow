export interface ModelProfile {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const MODEL_PROFILES_KEY = "prompt-workflow-editor.modelProfiles";

const createId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `model_${crypto.randomUUID()}`;
  return `model_${Date.now()}_${Math.random().toString(36).slice(2)}`;
};

export const createModelProfile = (index = 1): ModelProfile => ({
  id: createId(),
  name: index === 1 ? "OpenAI" : `模型配置 ${index}`,
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4.1-mini",
  temperature: 0.7,
});

export function loadModelProfiles(): ModelProfile[] {
  try {
    const raw = localStorage.getItem(MODEL_PROFILES_KEY);
    if (!raw) return [createModelProfile()];
    const parsed = JSON.parse(raw) as Partial<ModelProfile>[];
    if (!Array.isArray(parsed) || parsed.length === 0) return [createModelProfile()];
    return parsed.map((item, index) => ({
      id: item.id || createId(),
      name: item.name || `模型配置 ${index + 1}`,
      baseUrl: item.baseUrl || "https://api.openai.com/v1",
      apiKey: item.apiKey || "",
      model: item.model || "",
      temperature: typeof item.temperature === "number" ? item.temperature : 0.7,
    }));
  } catch {
    return [createModelProfile()];
  }
}

export function saveModelProfiles(profiles: ModelProfile[]) {
  localStorage.setItem(MODEL_PROFILES_KEY, JSON.stringify(profiles));
}

function chatCompletionsUrl(baseUrl: string) {
  const normalized = baseUrl.trim().replace(/\/+$/g, "");
  if (/\/chat\/completions$/i.test(normalized)) return normalized;
  return `${normalized}/chat/completions`;
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) return String(part.text ?? "");
        return "";
      })
      .join("");
  }
  return "";
}

export async function requestChatCompletion(
  profile: ModelProfile,
  systemPrompt: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
) {
  if (!profile.baseUrl.trim()) throw new Error("请先填写 Base URL。");
  if (!profile.model.trim()) throw new Error("请先填写模型名称。");

  let response: Response;
  try {
    response = await fetch(chatCompletionsUrl(profile.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(profile.apiKey.trim() ? { Authorization: `Bearer ${profile.apiKey.trim()}` } : {}),
      },
      body: JSON.stringify({
        model: profile.model.trim(),
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        temperature: profile.temperature,
        stream: false,
      }),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new Error(`请求失败：${error instanceof Error ? error.message : "网络错误"}。如果地址可访问，请检查服务是否允许浏览器跨域请求（CORS）。`);
  }

  const raw = await response.text();
  let payload: unknown = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const data = payload as { error?: { message?: string } | string; message?: string } | null;
    const apiMessage = typeof data?.error === "string" ? data.error : data?.error?.message || data?.message;
    throw new Error(apiMessage || `API 返回 ${response.status} ${response.statusText}`);
  }

  const data = payload as { choices?: Array<{ message?: { content?: unknown }; text?: string }> } | null;
  const content = messageText(data?.choices?.[0]?.message?.content) || data?.choices?.[0]?.text || "";
  if (!content.trim()) throw new Error("API 返回成功，但没有可显示的回复内容。");
  return content.trim();
}
