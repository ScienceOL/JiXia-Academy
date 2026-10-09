import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/Icon";
import {
  downloadDocument,
  MODEL_OPTIONS,
  useChatStore,
  useWorkspaceStore,
} from "@/store-e";

const ACCEPT = ".pdf,.txt,.md,.csv,.json";
const MAX_UPLOAD = 20 * 1024 * 1024;
const PAGE_SIZE = 6;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatDate(unix: number) {
  return new Date(unix * 1000).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 阶段 E：课题详情 `/repo/repository/:id`。 */
export function SubjectDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const subjectId = Number(id);
  const fileInput = useRef<HTMLInputElement>(null);

  const subject = useWorkspaceStore((state) => state.subject);
  const documents = useWorkspaceStore((state) => state.documents);
  const subjectTools = useWorkspaceStore((state) => state.subjectTools);
  const detailLoading = useWorkspaceStore((state) => state.detailLoading);
  const detailError = useWorkspaceStore((state) => state.detailError);
  const catalog = useWorkspaceStore((state) => state.catalog);
  const toolFields = useWorkspaceStore((state) => state.toolFields);
  const toolPurposes = useWorkspaceStore((state) => state.toolPurposes);
  const toolTotal = useWorkspaceStore((state) => state.toolTotal);
  const toolQuery = useWorkspaceStore((state) => state.toolQuery);
  const toolsLoading = useWorkspaceStore((state) => state.toolsLoading);
  const loadSubject = useWorkspaceStore((state) => state.loadSubject);
  const uploadDocument = useWorkspaceStore((state) => state.uploadDocument);
  const deleteDocument = useWorkspaceStore((state) => state.deleteDocument);
  const setToolQuery = useWorkspaceStore((state) => state.setToolQuery);
  const loadTools = useWorkspaceStore((state) => state.loadTools);
  const addSubjectTool = useWorkspaceStore((state) => state.addSubjectTool);
  const removeSubjectTool = useWorkspaceStore((state) => state.removeSubjectTool);

  const draft = useChatStore((state) => state.draft);
  const setDraft = useChatStore((state) => state.setDraft);
  const mode = useChatStore((state) => state.mode);
  const setMode = useChatStore((state) => state.setMode);
  const model = useChatStore((state) => state.model);
  const setModel = useChatStore((state) => state.setModel);
  const setSubjectId = useChatStore((state) => state.setSubjectId);
  const chatSending = useChatStore((state) => state.sending);
  const chatError = useChatStore((state) => state.error);
  const startConversation = useChatStore((state) => state.startConversation);

  const [page, setPage] = useState(1);
  const [uploadError, setUploadError] = useState("");
  const [downloading, setDownloading] = useState<number | null>(null);

  useEffect(() => {
    if (Number.isFinite(subjectId)) {
      void loadSubject(subjectId);
      setSubjectId(subjectId);
    }
  }, [subjectId, loadSubject, setSubjectId]);

  useEffect(() => {
    void loadTools();
  }, [loadTools]);

  useEffect(() => {
    setPage(1);
  }, [toolQuery]);

  const pageCount = Math.max(1, Math.ceil(catalog.length / PAGE_SIZE));
  const visibleTools = useMemo(
    () => catalog.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [catalog, page],
  );
  const associatedIds = useMemo(
    () => new Set(subjectTools.map((item) => item.tool_id)),
    [subjectTools],
  );

  function pickFile() {
    fileInput.current?.click();
  }

  async function onFileChange(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    setUploadError("");
    if (file.size > MAX_UPLOAD) {
      setUploadError("文件超过 20 MiB 上限，本地演示不接受该文件。");
      return;
    }
    await uploadDocument(subjectId, file);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function download(document: (typeof documents)[number]) {
    setDownloading(document.id);
    try {
      await downloadDocument(document);
    } finally {
      setDownloading(null);
    }
  }

  async function sendToChat() {
    const content = draft.trim();
    if (!content) return;
    const newId = await startConversation(subjectId);
    if (newId !== null) {
      navigate(`/chat/${newId}`);
    }
  }

  if (detailLoading && !subject) {
    return <p className="panel-hint">正在加载课题详情…</p>;
  }

  if (!subject) {
    return (
      <Card className="chat-empty">
        <p>{detailError || "未找到该课题，或你没有访问权限。"}</p>
        <Button className="button button-dark" onClick={() => navigate("/repo/repository")}>
          返回课题空间
        </Button>
      </Card>
    );
  }

  return (
    <>
      <div className="subject-crumb">
        <button onClick={() => navigate("/repo/repository")}>课题空间</button>
        <span className="crumb-slash">/</span>
        <strong>{subject.name}</strong>
      </div>

      <section className="subject-head">
        <div>
          <div className="overline">
            <span>SUBJECT</span>
            <span>·</span>
            <span>{subject.field || "未分类"}</span>
          </div>
          <h1>{subject.name}</h1>
          <p>{subject.description || "（暂无描述）"}</p>
          <div className="subject-head-meta">
            <span>创建于 {formatDate(subject.created_at)}</span>
            <span>更新于 {formatDate(subject.updated_at)}</span>
          </div>
        </div>
        <Badge className="offline-chip">
          <i />
          本地课题
        </Badge>
      </section>

      {detailError && (
        <div className="inline-error" role="alert">
          <span>{detailError}</span>
        </div>
      )}

      <div className="subject-columns">
        <div className="subject-main">
          <Card className="kb-card">
            <div className="card-heading">
              <div>
                <div className="section-kicker">KNOWLEDGE BASE</div>
                <h3>知识库文件</h3>
              </div>
              <div className="kb-actions">
                <Button className="button button-outline" onClick={pickFile}>
                  <Icon name="upload" size={14} />
                  上传文件
                </Button>
              </div>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPT}
              className="visually-hidden"
              onChange={(event) => void onFileChange(event.target.files)}
            />
            <p className="kb-note">
              支持 pdf / txt / md / csv / json，单文件 ≤20 MiB。“上传文件夹”受浏览器限制，暂不可用（占位）。
            </p>
            {uploadError && (
              <div className="inline-error" role="alert">
                <span>{uploadError}</span>
              </div>
            )}

            {documents.length === 0 ? (
              <p className="panel-hint">知识库为空。上传文件后即可在对话中引用其文件名。</p>
            ) : (
              <div className="kb-list">
                {documents.map((document) => (
                  <div className="kb-row" key={document.id}>
                    <span className="kb-icon">
                      <Icon name="file" size={16} />
                    </span>
                    <div className="kb-info">
                      <strong>{document.original_name}</strong>
                      <span>
                        {document.content_type || "未知类型"} · {formatBytes(document.byte_size)} · SHA-256{" "}
                        <code>{document.sha256.slice(0, 8)}</code> · {formatDate(document.created_at)}
                      </span>
                    </div>
                    <button
                      className="kb-action"
                      aria-label={`下载 ${document.original_name}`}
                      disabled={downloading === document.id}
                      onClick={() => void download(document)}
                    >
                      <Icon name="download" size={15} />
                    </button>
                    <button
                      className="kb-action kb-action-danger"
                      aria-label={`删除 ${document.original_name}`}
                      onClick={() => void deleteDocument(document)}
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="tool-card">
            <div className="card-heading">
              <div>
                <div className="section-kicker">TOOL CATALOG · READ ONLY</div>
                <h3>推荐工具目录</h3>
              </div>
              <span className="event-count">{toolTotal} TOOLS</span>
            </div>

            <div className="tool-filters">
              <label className="tool-search">
                <Icon name="search" size={14} />
                <input
                  type="search"
                  value={toolQuery.q}
                  placeholder="搜索工具名称或说明"
                  onChange={(event) => setToolQuery({ q: event.target.value })}
                />
              </label>
              <select
                value={toolQuery.field}
                onChange={(event) => setToolQuery({ field: event.target.value })}
                aria-label="按学科筛选"
              >
                <option value="">全部学科</option>
                {toolFields.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <select
                value={toolQuery.purpose}
                onChange={(event) => setToolQuery({ purpose: event.target.value })}
                aria-label="按用途筛选"
              >
                <option value="">全部用途</option>
                {toolPurposes.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <select
                value={toolQuery.sort}
                onChange={(event) => setToolQuery({ sort: event.target.value })}
                aria-label="排序"
              >
                <option value="name">按名称</option>
                <option value="field">按学科</option>
                <option value="purpose">按用途</option>
              </select>
            </div>

            {toolsLoading ? (
              <p className="panel-hint">正在加载工具目录…</p>
            ) : visibleTools.length === 0 ? (
              <p className="panel-hint">没有符合条件的工具。</p>
            ) : (
              <div className="tool-list">
                {visibleTools.map((tool) => {
                  const added = associatedIds.has(tool.id);
                  return (
                    <div className="tool-row" key={tool.id}>
                      <div className="tool-info">
                        <div className="tool-title">
                          <strong>{tool.name}</strong>
                          <Badge variant="outline">{tool.kind === "scp" ? "SCP" : "SKILL"}</Badge>
                          {tool.simulated && <Badge variant="secondary">模拟</Badge>}
                        </div>
                        <p>{tool.summary}</p>
                        <span className="tool-tags">
                          {tool.field} · {tool.purpose}
                        </span>
                      </div>
                      <Button
                        className={`button ${added ? "button-outline" : "button-dark"}`}
                        disabled={added}
                        onClick={() => void addSubjectTool(subjectId, tool.id)}
                      >
                        {added ? "已关联" : "添加到课题"}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}

            {pageCount > 1 && (
              <div className="tool-pager">
                <button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                  上一页
                </button>
                <span>
                  {page} / {pageCount}
                </span>
                <button
                  disabled={page >= pageCount}
                  onClick={() => setPage((value) => value + 1)}
                >
                  下一页
                </button>
              </div>
            )}
          </Card>
        </div>

        <aside className="subject-side">
          <Card className="linked-card">
            <div className="card-heading">
              <div>
                <div className="section-kicker">LINKED</div>
                <h3>已关联工具</h3>
              </div>
              <span className="event-count">{subjectTools.length}</span>
            </div>
            {subjectTools.length === 0 ? (
              <p className="panel-hint">尚未关联工具。从左侧目录添加。</p>
            ) : (
              <div className="linked-list">
                {subjectTools.map((item) => (
                  <div className="linked-row" key={item.tool_id}>
                    <div>
                      <strong>{item.tool?.name ?? item.tool_id}</strong>
                      <span>{item.tool?.purpose ?? "来自本地目录"}</span>
                    </div>
                    <button
                      className="kb-action kb-action-danger"
                      aria-label="解除关联"
                      onClick={() => void removeSubjectTool(subjectId, item.tool_id)}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="subject-chat-card">
            <div className="card-heading">
              <div>
                <div className="section-kicker">SUBJECT CHAT</div>
                <h3>课题内对话</h3>
              </div>
            </div>
            <p className="panel-hint">默认绑定当前课题；回复为本地模拟内容。</p>

            <div className="composer-controls">
              <div className="mode-toggle" role="group" aria-label="对话模式">
                <button
                  className={mode === "quick" ? "is-active" : ""}
                  onClick={() => setMode("quick")}
                >
                  快速
                </button>
                <button
                  className={mode === "deep" ? "is-active" : ""}
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
            </div>

            <textarea
              className="subject-chat-input"
              value={draft}
              rows={4}
              maxLength={4000}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="就当前课题提问…"
            />

            <div className="mention-row">
              <span>引用文件（@）</span>
              {documents.length === 0 ? (
                <em>知识库为空</em>
              ) : (
                documents.map((document) => (
                  <button
                    key={document.id}
                    onClick={() => setDraft(`${draft}${draft ? " " : ""}@${document.original_name} `)}
                  >
                    @{document.original_name}
                  </button>
                ))
              )}
            </div>

            {chatError && (
              <div className="inline-error" role="alert">
                <span>{chatError}</span>
              </div>
            )}

            <Button
              className="button button-dark subject-chat-send"
              disabled={!draft.trim() || chatSending}
              onClick={() => void sendToChat()}
            >
              {chatSending ? "正在生成…" : "发送并进入会话"}
              <Icon name="arrow" size={15} />
            </Button>
          </Card>
        </aside>
      </div>
    </>
  );
}
