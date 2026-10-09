import { useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/Icon";
import { useChatStore, useWorkspaceStore, EXAMPLE_QUESTIONS, MODEL_OPTIONS } from "@/store-e";

function formatWhen(unix: number) {
  return new Date(unix * 1000).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 阶段 E：对话页 `/chat` 与 `/chat/:id`。 */
export function ChatPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const conversations = useChatStore((state) => state.conversations);
  const listLoading = useChatStore((state) => state.listLoading);
  const active = useChatStore((state) => state.active);
  const detailLoading = useChatStore((state) => state.detailLoading);
  const sending = useChatStore((state) => state.sending);
  const error = useChatStore((state) => state.error);
  const draft = useChatStore((state) => state.draft);
  const mode = useChatStore((state) => state.mode);
  const model = useChatStore((state) => state.model);
  const subjectId = useChatStore((state) => state.subjectId);
  const lastMeta = useChatStore((state) => state.lastMeta);
  const setDraft = useChatStore((state) => state.setDraft);
  const setMode = useChatStore((state) => state.setMode);
  const setModel = useChatStore((state) => state.setModel);
  const setSubjectId = useChatStore((state) => state.setSubjectId);
  const loadConversations = useChatStore((state) => state.loadConversations);
  const openConversation = useChatStore((state) => state.openConversation);
  const clearActive = useChatStore((state) => state.clearActive);
  const removeConversation = useChatStore((state) => state.removeConversation);
  const startConversation = useChatStore((state) => state.startConversation);
  const sendMessage = useChatStore((state) => state.sendMessage);

  const subjects = useWorkspaceStore((state) => state.subjects);
  const loadWorkspace = useWorkspaceStore((state) => state.loadWorkspace);

  useEffect(() => {
    void loadConversations();
    void loadWorkspace();
  }, [loadConversations, loadWorkspace]);

  useEffect(() => {
    if (id) {
      const numeric = Number(id);
      if (Number.isFinite(numeric)) {
        void openConversation(numeric);
      }
    } else {
      clearActive();
    }
  }, [id, openConversation, clearActive]);

  // 默认选中最近课题（仅首页需要绑定课题时使用）。
  useEffect(() => {
    if (subjectId === null && subjects.length > 0) {
      setSubjectId(subjects[0].id);
    }
  }, [subjectId, subjects, setSubjectId]);

  const subjectOptions = useMemo(
    () => subjects.map((subject) => ({ id: subject.id, name: subject.name })),
    [subjects],
  );
  const activeSubjectName = useMemo(() => {
    if (!active) return "";
    return active.subject_name;
  }, [active]);

  const canStart = draft.trim().length > 0 && subjectId !== null && !sending;

  async function launch() {
    if (subjectId === null) return;
    const newId = await startConversation(subjectId);
    if (newId !== null) {
      navigate(`/chat/${newId}`);
    }
  }

  return (
    <div className="chat-layout">
      <aside className="chat-history">
        <div className="chat-history-head">
          <div>
            <div className="section-kicker">CONVERSATIONS</div>
            <h2>会话历史</h2>
          </div>
          <Button
            className="button button-outline"
            onClick={() => {
              clearActive();
              setDraft("");
              navigate("/chat");
            }}
          >
            <Icon name="plus" size={14} />
            新对话
          </Button>
        </div>

        {listLoading && <p className="panel-hint">正在加载会话…</p>}
        {!listLoading && conversations.length === 0 && (
          <p className="panel-hint">还没有会话。在右侧选定课题并发起第一轮提问。</p>
        )}

        <ul className="conversation-list">
          {conversations.map((item) => (
            <li
              key={item.id}
              className={`conversation-item ${active?.conversation.id === item.id ? "is-active" : ""}`}
            >
              <button
                className="conversation-open"
                onClick={() => navigate(`/chat/${item.id}`)}
              >
                <span className="conversation-subject">{item.subject_name}</span>
                <strong>{item.title}</strong>
                <span className="conversation-meta">
                  {formatWhen(item.updated_at)} · {item.message_count} 条消息
                </span>
              </button>
              <button
                className="conversation-delete"
                aria-label={`删除会话 ${item.title}`}
                onClick={() => void removeConversation(item.id)}
              >
                <Icon name="trash" size={14} />
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="chat-stage">
        {error && (
          <div className="inline-error" role="alert">
            <span>{error}</span>
          </div>
        )}

        {id && !active && detailLoading ? (
          <p className="panel-hint">正在加载会话…</p>
        ) : id && active ? (
          <>
            <header className="chat-head">
              <div>
                <div className="section-kicker">{activeSubjectName || "课题会话"}</div>
                <h1>{active.conversation.title}</h1>
              </div>
              <Badge className="offline-chip">
                <i />
                {active.conversation.mode === "deep" ? "深度" : "快速"} · 模拟
              </Badge>
            </header>

            <div className="message-stream">
              {active.messages.map((message) => (
                <div
                  key={message.id}
                  className={`message ${message.role === "user" ? "message-user" : "message-assistant"}`}
                >
                  <div className="message-bubble">
                    <div className="message-topline">
                      <span>{message.role === "user" ? "我" : "A3S 模拟回复"}</span>
                      <time>{formatWhen(message.created_at)}</time>
                    </div>
                    <p>{message.content}</p>
                    {message.role !== "user" && lastMeta && (
                      <div className="message-meta">
                        <Badge variant="secondary">模拟回复</Badge>
                        <span>
                          {lastMeta.runtime} · {lastMeta.model_source} · 模型调用{" "}
                          {lastMeta.fixture_calls} 次 · 外网 {lastMeta.network_used ? "有" : "无"}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <ChatComposer
              draft={draft}
              setDraft={setDraft}
              mode={mode}
              setMode={setMode}
              model={model}
              setModel={setModel}
              sending={sending}
              onSend={() => void sendMessage(draft)}
              disabled={false}
            />
          </>
        ) : (
          <>
            <header className="chat-head chat-head-home">
              <div>
                <div className="section-kicker">NEW CONVERSATION</div>
                <h1>从一个问题开始</h1>
                <p>
                  选择课题后提问；回复来自本地模板响应模型，非真实 AI 推理，也不访问外网。
                </p>
              </div>
            </header>

            {subjectOptions.length === 0 ? (
              <Card className="chat-empty">
                <p>还没有课题。请先到「课题空间」创建一个课题，再回到这里发起对话。</p>
                <Button className="button button-dark" onClick={() => navigate("/repo/repository")}>
                  前往课题空间
                  <Icon name="arrow" size={15} />
                </Button>
              </Card>
            ) : (
              <div className="chat-home">
                <label className="field field-inline">
                  <span>课题</span>
                  <select
                    value={subjectId ?? ""}
                    onChange={(event) => setSubjectId(Number(event.target.value))}
                  >
                    {subjectOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </label>

                <ChatComposer
                  draft={draft}
                  setDraft={setDraft}
                  mode={mode}
                  setMode={setMode}
                  model={model}
                  setModel={setModel}
                  sending={sending}
                  onSend={() => void launch()}
                  disabled={!canStart}
                  large
                />

                <div className="example-block">
                  <div className="section-kicker">示例问题 · 仅填入不发送</div>
                  <div className="example-list">
                    {EXAMPLE_QUESTIONS.map((question) => (
                      <button key={question} onClick={() => setDraft(question)}>
                        {question}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

type ComposerProps = {
  draft: string;
  setDraft: (value: string) => void;
  mode: "quick" | "deep";
  setMode: (mode: "quick" | "deep") => void;
  model: string;
  setModel: (model: string) => void;
  sending: boolean;
  onSend: () => void;
  disabled: boolean;
  large?: boolean;
};

function ChatComposer({
  draft,
  setDraft,
  mode,
  setMode,
  model,
  setModel,
  sending,
  onSend,
  disabled,
  large,
}: ComposerProps) {
  return (
    <div className={`composer ${large ? "composer-large" : ""}`}>
      <div className="composer-controls">
        <div className="mode-toggle" role="group" aria-label="对话模式">
          <button
            className={mode === "quick" ? "is-active" : ""}
            aria-pressed={mode === "quick"}
            onClick={() => setMode("quick")}
          >
            快速
          </button>
          <button
            className={mode === "deep" ? "is-active" : ""}
            aria-pressed={mode === "deep"}
            onClick={() => setMode("deep")}
          >
            深度
          </button>
        </div>
        <label className="model-select">
          <span>模型</span>
          <select value={model} onChange={(event) => setModel(event.target.value)}>
            {MODEL_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button className="composer-attach" disabled title="附件上传为占位功能，本阶段不可用">
          <Icon name="plus" size={14} />
          附件（暂不可用）
        </button>
      </div>

      <div className="composer-input">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="输入你的研究问题…（回复为本地模拟内容）"
          rows={large ? 4 : 3}
          maxLength={4000}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              if (!disabled) onSend();
            }
          }}
        />
        <Button
          className="button button-dark composer-send"
          onClick={onSend}
          disabled={disabled || draft.trim().length === 0}
        >
          {sending ? (
            <>
              <span className="spinner" />
              正在生成…
            </>
          ) : (
            <>
              <Icon name="send" size={15} />
              发送
            </>
          )}
        </Button>
      </div>
      <p className="composer-note">⌘/Ctrl + Enter 发送 · 内容 ≤4000 字 · 模拟回复不代表科研结论</p>
    </div>
  );
}
