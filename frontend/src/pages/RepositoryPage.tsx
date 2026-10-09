import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/Icon";
import { FIELD_OPTIONS, useWorkspaceStore } from "@/store-e";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatDate(unix: number) {
  return new Date(unix * 1000).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

const MAX_NAME = 50;
const MAX_DESCRIPTION = 200;

/** 阶段 E：课题空间 `/repo/repository`。 */
export function RepositoryPage() {
  const navigate = useNavigate();
  const subjects = useWorkspaceStore((state) => state.subjects);
  const summary = useWorkspaceStore((state) => state.summary);
  const listLoading = useWorkspaceStore((state) => state.listLoading);
  const error = useWorkspaceStore((state) => state.error);
  const loadWorkspace = useWorkspaceStore((state) => state.loadWorkspace);
  const createSubject = useWorkspaceStore((state) => state.createSubject);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [field, setField] = useState(FIELD_OPTIONS[0]);
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const canCreate = name.trim().length > 0 && name.trim().length <= MAX_NAME;

  function resetForm() {
    setName("");
    setField(FIELD_OPTIONS[0]);
    setDescription("");
    setFormError("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canCreate || submitting) return;
    setSubmitting(true);
    const subject = await createSubject({
      name: name.trim(),
      field,
      description: description.trim(),
    });
    setSubmitting(false);
    if (subject) {
      setDialogOpen(false);
      resetForm();
      navigate(`/repo/repository/${subject.id}`);
    } else {
      setFormError("创建失败，请检查名称与网络后重试。");
    }
  }

  const stats: { label: string; value: string }[] = summary
    ? [
        { label: "课题", value: String(summary.subjects) },
        { label: "知识库文件", value: String(summary.documents) },
        { label: "会话", value: String(summary.conversations) },
        { label: "消息", value: String(summary.messages) },
        { label: "运行记录", value: String(summary.runs) },
        { label: "占用存储", value: formatBytes(summary.storage_bytes) },
      ]
    : [];

  return (
    <>
      <section className="repo-hero">
        <div>
          <div className="overline">
            <span>KNOWLEDGE REPOSITORY</span>
            <span>·</span>
            <span>LOCAL ONLY</span>
          </div>
          <h1>课题空间</h1>
          <p>为每个研究方向建立课题，集中管理知识库文件、推荐工具与课题内对话。</p>
        </div>
        <Button className="button button-dark" onClick={() => setDialogOpen(true)}>
          <Icon name="plus" size={15} />
          创建课题
        </Button>
      </section>

      <Card className="summary-card">
        <div className="card-heading">
          <div>
            <div className="section-kicker">WORKSPACE SUMMARY</div>
            <h3>用量摘要</h3>
          </div>
          <Badge className="offline-chip">
            <i />
            本地数据库
          </Badge>
        </div>
        {summary ? (
          <div className="summary-grid">
            {stats.map((stat) => (
              <div className="summary-stat" key={stat.label}>
                <strong>{stat.value}</strong>
                <span>{stat.label}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="panel-hint">正在加载用量…</p>
        )}
      </Card>

      {error && (
        <div className="inline-error" role="alert">
          <span>{error}</span>
          <button onClick={() => void loadWorkspace()}>重试</button>
        </div>
      )}

      <section className="subject-section" aria-label="课题列表">
        <div className="section-heading">
          <div>
            <div className="section-kicker">SUBJECTS</div>
            <h2>我的课题</h2>
          </div>
          <span className="event-count">{subjects.length} SUBJECTS</span>
        </div>

        {listLoading && <p className="panel-hint">正在加载课题…</p>}
        {!listLoading && subjects.length === 0 && (
          <Card className="chat-empty">
            <p>还没有课题。创建第一个课题，开始整理知识库并与之对话。</p>
            <Button className="button button-dark" onClick={() => setDialogOpen(true)}>
              创建课题
              <Icon name="arrow" size={15} />
            </Button>
          </Card>
        )}

        <div className="subject-grid">
          {subjects.map((subject) => (
            <button
              key={subject.id}
              className="subject-card"
              onClick={() => navigate(`/repo/repository/${subject.id}`)}
            >
              <div className="subject-card-top">
                <span className="subject-mark">{(subject.name[0] ?? "课").toUpperCase()}</span>
                <Badge variant="outline">{subject.field || "未分类"}</Badge>
              </div>
              <h3>{subject.name}</h3>
              <p>{subject.description || "（暂无描述）"}</p>
              <div className="subject-card-foot">
                <span>更新于 {formatDate(subject.updated_at)}</span>
                <Icon name="arrow" size={15} />
              </div>
            </button>
          ))}
        </div>
      </section>

      {dialogOpen && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onClick={() => {
            setDialogOpen(false);
            resetForm();
          }}
        >
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-subject-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-head">
              <div>
                <div className="section-kicker">NEW SUBJECT</div>
                <h2 id="create-subject-title">创建课题</h2>
              </div>
              <button
                className="icon-button dialog-close"
                aria-label="关闭"
                onClick={() => {
                  setDialogOpen(false);
                  resetForm();
                }}
              >
                ✕
              </button>
            </div>

            <form className="dialog-form" onSubmit={submit}>
              <label className="field">
                <span>
                  名称 <b>*</b>
                  <i>{name.trim().length}/{MAX_NAME}</i>
                </span>
                <input
                  type="text"
                  value={name}
                  maxLength={MAX_NAME}
                  autoFocus
                  onChange={(event) => {
                    setName(event.target.value);
                    setFormError("");
                  }}
                  placeholder="例如：AmeR 定向进化"
                  required
                />
              </label>

              <label className="field">
                <span>领域</span>
                <select value={field} onChange={(event) => setField(event.target.value)}>
                  {FIELD_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>
                  描述
                  <i>{description.trim().length}/{MAX_DESCRIPTION}</i>
                </span>
                <textarea
                  value={description}
                  rows={3}
                  maxLength={MAX_DESCRIPTION}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="简要说明研究目标与边界（可选）"
                />
              </label>

              {formError && (
                <div className="inline-error" role="alert">
                  <span>{formError}</span>
                </div>
              )}

              <div className="dialog-actions">
                <Button
                  type="button"
                  variant="ghost"
                  className="button"
                  onClick={() => {
                    setDialogOpen(false);
                    resetForm();
                  }}
                >
                  取消
                </Button>
                <Button
                  type="submit"
                  className="button button-dark"
                  disabled={!canCreate || submitting}
                >
                  {submitting ? "正在创建…" : "创建课题"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
