import { Bot, Eraser, Play, RotateCcw, Send, Settings2, Square, UserRound, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  requestChatCompletion,
  type ChatMessage,
  type ModelProfile,
} from "./modelProfiles";

interface ConversationColumn {
  id: string;
  profileId: string;
  messages: ChatMessage[];
  pending: boolean;
  error: string;
}

interface TestBenchSettings {
  columnCount: number;
  openingMessage: string;
  profileIds: string[];
}

const TEST_BENCH_KEY = "prompt-workflow-editor.testBench";

function readSettings(workflowId: string, profiles: ModelProfile[]): TestBenchSettings {
  try {
    const all = JSON.parse(localStorage.getItem(TEST_BENCH_KEY) || "{}") as Record<string, Partial<TestBenchSettings>>;
    const saved = all[workflowId] ?? {};
    return {
      columnCount: Math.min(6, Math.max(1, Number(saved.columnCount) || 2)),
      openingMessage: typeof saved.openingMessage === "string" ? saved.openingMessage : "",
      profileIds: Array.isArray(saved.profileIds) ? saved.profileIds : profiles.map((profile) => profile.id),
    };
  } catch {
    return { columnCount: 2, openingMessage: "", profileIds: profiles.map((profile) => profile.id) };
  }
}

function writeSettings(workflowId: string, settings: TestBenchSettings) {
  try {
    const all = JSON.parse(localStorage.getItem(TEST_BENCH_KEY) || "{}") as Record<string, TestBenchSettings>;
    all[workflowId] = settings;
    localStorage.setItem(TEST_BENCH_KEY, JSON.stringify(all));
  } catch {
    // 对话测试仍然可以继续；仅跳过偏好保存。
  }
}

function initialMessages(openingMessage: string): ChatMessage[] {
  return openingMessage.trim() ? [{ role: "assistant", content: openingMessage.trim() }] : [];
}

function createColumns(profiles: ModelProfile[], settings: TestBenchSettings): ConversationColumn[] {
  return Array.from({ length: 6 }, (_, index) => ({
    id: `conversation_${index + 1}`,
    profileId: settings.profileIds[index] && profiles.some((profile) => profile.id === settings.profileIds[index])
      ? settings.profileIds[index]
      : profiles[index % Math.max(1, profiles.length)]?.id ?? "",
    messages: initialMessages(settings.openingMessage),
    pending: false,
    error: "",
  }));
}

export function PromptTestBench({
  workflowId,
  workflowTitle,
  prompt,
  profiles,
  onOpenSettings,
  onClose,
}: {
  workflowId: string;
  workflowTitle: string;
  prompt: string;
  profiles: ModelProfile[];
  onOpenSettings: () => void;
  onClose: () => void;
}) {
  const initial = useMemo(() => readSettings(workflowId, profiles), [workflowId]);
  const [columnCount, setColumnCount] = useState(initial.columnCount);
  const [openingMessage, setOpeningMessage] = useState(initial.openingMessage);
  const [columns, setColumns] = useState(() => createColumns(profiles, initial));
  const [draftMessage, setDraftMessage] = useState("");
  const [showOpeningEditor, setShowOpeningEditor] = useState(!initial.openingMessage);
  const abortControllers = useRef(new Map<string, AbortController>());

  useEffect(() => {
    const profileIds = columns.map((column) => column.profileId);
    writeSettings(workflowId, { columnCount, openingMessage, profileIds });
  }, [columnCount, columns, openingMessage, workflowId]);

  useEffect(() => {
    setColumns((current) => current.map((column, index) => ({
      ...column,
      profileId: profiles.some((profile) => profile.id === column.profileId)
        ? column.profileId
        : profiles[index % Math.max(1, profiles.length)]?.id ?? "",
    })));
  }, [profiles]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !window.document.querySelector(".dialogBackdrop")) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      for (const controller of abortControllers.current.values()) controller.abort();
    };
  }, [onClose]);

  const updateColumn = (columnId: string, updater: (column: ConversationColumn) => ConversationColumn) => {
    setColumns((current) => current.map((column) => column.id === columnId ? updater(column) : column));
  };

  const resetAll = () => {
    for (const controller of abortControllers.current.values()) controller.abort();
    abortControllers.current.clear();
    setColumns((current) => current.map((column) => ({
      ...column,
      messages: initialMessages(openingMessage),
      pending: false,
      error: "",
    })));
  };

  const sendToAll = async () => {
    const content = draftMessage.trim();
    if (!content) return;
    setDraftMessage("");
    const targets = columns.slice(0, columnCount);

    await Promise.allSettled(targets.map(async (column) => {
      const profile = profiles.find((item) => item.id === column.profileId);
      const messages: ChatMessage[] = [...column.messages, { role: "user", content }];
      updateColumn(column.id, (current) => ({ ...current, messages, pending: true, error: "" }));

      if (!profile) {
        updateColumn(column.id, (current) => ({ ...current, pending: false, error: "请选择有效的模型配置。" }));
        return;
      }

      const controller = new AbortController();
      abortControllers.current.set(column.id, controller);
      try {
        const reply = await requestChatCompletion(profile, prompt, messages, controller.signal);
        updateColumn(column.id, (current) => ({
          ...current,
          messages: [...current.messages, { role: "assistant", content: reply }],
          pending: false,
          error: "",
        }));
      } catch (error) {
        const aborted = error instanceof DOMException && error.name === "AbortError";
        updateColumn(column.id, (current) => ({
          ...current,
          pending: false,
          error: aborted ? "已停止生成。" : error instanceof Error ? error.message : "请求失败。",
        }));
      } finally {
        abortControllers.current.delete(column.id);
      }
    }));
  };

  const stopColumn = (columnId: string) => abortControllers.current.get(columnId)?.abort();

  return (
    <section className="testBench" role="dialog" aria-modal="true" aria-label="Prompt 对话测试台">
      <header className="testBenchHeader">
        <div className="testBenchTitle">
          <Play size={19} />
          <div>
            <h2>Prompt 对话测试台</h2>
            <p>{workflowTitle} · 当前 Prompt {prompt.length.toLocaleString()} 字符</p>
          </div>
        </div>
        <div className="testBenchActions">
          <label className="columnCountControl">对比列数
            <select value={columnCount} onChange={(event) => setColumnCount(Number(event.target.value))}>
              {[1, 2, 3, 4, 5, 6].map((count) => <option key={count} value={count}>{count} 列</option>)}
            </select>
          </label>
          <button onClick={() => setShowOpeningEditor((value) => !value)}><Bot size={16} /> 开场白</button>
          <button onClick={onOpenSettings}><Settings2 size={16} /> 模型设置</button>
          <button onClick={resetAll}><RotateCcw size={16} /> 重置对话</button>
          <button className="iconButton" title="关闭测试台" onClick={onClose}><X size={19} /></button>
        </div>
      </header>

      {showOpeningEditor && (
        <div className="openingEditor">
          <label>AI 开场白
            <textarea
              rows={2}
              value={openingMessage}
              onChange={(event) => setOpeningMessage(event.target.value)}
              placeholder="例如：您好，我是您的产品顾问。今天想先了解一下您正在经营哪类产品？"
            />
          </label>
          <div>
            <p>作为 assistant 的第一条消息加入每列对话。修改后点击应用会清空当前对话。</p>
            <button className="primaryButton" onClick={() => {
              resetAll();
              setShowOpeningEditor(false);
            }}>应用并重置对话</button>
          </div>
        </div>
      )}

      <div className="conversationScroller">
        <div className="conversationGrid" style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(320px, 1fr))` }}>
          {columns.slice(0, columnCount).map((column, index) => {
            const profile = profiles.find((item) => item.id === column.profileId);
            return (
              <article className="conversationColumn" key={column.id}>
                <header>
                  <div><strong>对话 {index + 1}</strong><span>{profile?.model || "未选择模型"}</span></div>
                  <button title="清空本列" onClick={() => updateColumn(column.id, (current) => ({
                    ...current,
                    messages: initialMessages(openingMessage),
                    error: "",
                  }))}><Eraser size={15} /></button>
                </header>
                <select
                  value={column.profileId}
                  onChange={(event) => updateColumn(column.id, (current) => ({ ...current, profileId: event.target.value }))}
                >
                  {profiles.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.model || "未设置模型"}</option>)}
                </select>
                <div className="messageList">
                  {column.messages.length === 0 && (
                    <div className="emptyConversation"><Bot size={21} /><span>输入消息后，将使用当前编译的 Prompt 开始测试。</span></div>
                  )}
                  {column.messages.map((message, messageIndex) => (
                    <div className={`chatMessage ${message.role}`} key={`${column.id}_${messageIndex}`}>
                      <span>{message.role === "assistant" ? <Bot size={15} /> : <UserRound size={15} />}</span>
                      <div><strong>{message.role === "assistant" ? "AI" : "用户"}</strong><p>{message.content}</p></div>
                    </div>
                  ))}
                  {column.pending && <div className="generatingRow"><span />正在生成回复…</div>}
                  {column.error && <div className="columnError">{column.error}</div>}
                </div>
                {column.pending && <button className="stopButton" onClick={() => stopColumn(column.id)}><Square size={13} /> 停止本列</button>}
              </article>
            );
          })}
        </div>
      </div>

      <footer className="testBenchComposer">
        <textarea
          rows={2}
          value={draftMessage}
          onChange={(event) => setDraftMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void sendToAll();
            }
          }}
          placeholder={`输入同一条用户消息，并行发送到 ${columnCount} 列（Enter 发送，Shift+Enter 换行）`}
        />
        <button className="primaryButton" disabled={!draftMessage.trim() || columns.slice(0, columnCount).some((column) => column.pending)} onClick={() => void sendToAll()}>
          <Send size={17} /> 发送到全部 {columnCount} 列
        </button>
      </footer>
    </section>
  );
}
