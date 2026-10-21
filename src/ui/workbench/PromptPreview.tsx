import { useEffect, useRef, useState } from "react";
import { ActionButton, useApplication } from "../context.tsx";
export function PromptPreview({
  text,
  streaming,
  waiting,
  interrupted,
  received,
  taskId,
  productId,
  error,
  failed,
  unvalidated,
  validationFailed,
}: {
  text: string;
  streaming: boolean;
  waiting: boolean;
  interrupted: boolean;
  received: boolean;
  taskId: string;
  productId: string;
  error?: string;
  failed?: boolean;
  unvalidated?: boolean;
  validationFailed?: boolean;
}) {
  const { controller } = useApplication();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const submitting = useRef(false);
  const formId = `inline-prompt-form-${taskId}`;
  const analysisError = interrupted
    ? error || "未能获得完整的提示词"
    : undefined;
  function edit() {
    setDraft(text);
    setSaveError("");
    setEditing(true);
  }
  const [visible, setVisible] = useState(text),
    target = useRef(text),
    viewport = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  target.current = text;
  useEffect(() => {
    if (!streaming || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisible(text);
      return;
    }
    setVisible((current) => (text.startsWith(current) ? current : text));
    const timer = setInterval(
      () =>
        setVisible((current) => {
          const next = target.current;
          if (!next.startsWith(current)) return next;
          return next.slice(
            0,
            current.length +
              Math.max(3, Math.ceil((next.length - current.length) / 12)),
          );
        }),
      24,
    );
    return () => clearInterval(timer);
  }, [streaming, text]);
  useEffect(() => {
    if (!editing && follow.current && viewport.current)
      viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [visible, editing]);
  return (
    <div
      className={`prompt-preview ${editing ? "is-editing" : ""} ${streaming ? "is-streaming" : ""} ${interrupted ? "has-prompt-error" : ""} ${!editing && !streaming && !interrupted && !waiting ? "is-ready" : ""}`}
    >
      <div className="prompt-preview-heading">
        <span className="prompt-state-dot" />
        <strong
          className={interrupted ? "prompt-error-title" : undefined}
          title={analysisError}
          tabIndex={interrupted ? 0 : undefined}
          aria-label={
            analysisError
              ? `${failed ? (validationFailed ? "提示词校验未通过" : "提示词生成失败") : "提示词生成中断"}：${analysisError}`
              : undefined
          }
        >
          {editing
            ? "编辑提示词"
            : interrupted
              ? failed
                ? validationFailed
                  ? "提示词校验未通过"
                  : "提示词生成失败"
                : "提示词生成中断"
              : streaming
                ? received
                  ? "正在编写提示词"
                  : "等待平台响应"
                : waiting
                  ? "等待提示词"
                  : "提示词已就绪"}
        </strong>
        {editing ? (
          <div className="prompt-header-actions">
            <small>{draft.length} 字符</small>
            <button
              type="submit"
              form={formId}
              className="primary"
              disabled={saving || !draft.trim()}
            >
              {saving ? "正在提交…" : "保存并重新生成"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => setEditing(false)}
            >
              取消
            </button>
          </div>
        ) : (
          <div className="prompt-header-actions">
            {interrupted && (
              <ActionButton
                className="card-reanalyze-button"
                action="generate-prompt"
                data={{ task: taskId }}
              >
                重新生成提示词
              </ActionButton>
            )}
            <small>{streaming ? "实时输出" : "点击编辑"}</small>
          </div>
        )}
      </div>
      {!editing && analysisError && (
        <p className="prompt-validation-message" role="alert">
          {analysisError}
        </p>
      )}
      <div
        className="prompt-preview-body"
        hidden={!editing && interrupted && !visible}
        ref={viewport}
        onScroll={(event) => {
          const el = event.currentTarget;
          follow.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {editing ? (
          <form
            id={formId}
            className="inline-prompt-form"
            aria-busy={saving}
            onSubmit={async (event) => {
              event.preventDefault();
              if (submitting.current) return;
              submitting.current = true;
              setSaving(true);
              setSaveError("");
              try {
                await controller.saveTaskPromptAndGenerate(
                  productId,
                  taskId,
                  draft,
                );
                setEditing(false);
              } catch (error) {
                setSaveError(
                  error instanceof Error ? error.message : "提交失败，请重试",
                );
              } finally {
                submitting.current = false;
                setSaving(false);
              }
            }}
          >
            <label
              className="visually-hidden"
              htmlFor={`inline-prompt-${taskId}`}
            >
              作图提示词
            </label>
            <textarea
              id={`inline-prompt-${taskId}`}
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={7}
              disabled={saving}
              placeholder="在这里编写这张图片的提示词…"
            />
            {saveError && (
              <p className="error-text" role="alert">
                {saveError}
              </p>
            )}
          </form>
        ) : visible ? (
          <div
            className="prompt-preview-text prompt-click-to-edit"
            role="button"
            tabIndex={0}
            aria-label="点击编辑提示词"
            onClick={edit}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                edit();
              }
            }}
          >
            {visible}
            {streaming && <span className="typing-caret" aria-hidden="true" />}
          </div>
        ) : !interrupted ? (
          <div
            className="prompt-waiting prompt-click-to-edit"
            role="button"
            tabIndex={0}
            aria-label="点击编写提示词"
            onClick={edit}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                edit();
              }
            }}
          >
            <span className="prompt-waiting-icon">✦</span>
            <strong>
              {streaming
                ? received
                  ? "正在统一整套设计"
                  : "等待平台返回提示词"
                : "从参考图开始，形成这张图的提示词"}
            </strong>
            <p>
              {streaming
                ? "该位置的文字返回后会在这里逐字呈现"
                : "点击这里直接编写，或生成整套提示词"}
            </p>
          </div>
        ) : null}
      </div>
      {!editing && (
        <div className="prompt-preview-footer">
          <span>
            {text
              ? `${text.length} 字符${streaming || unvalidated ? " · 未校验草稿" : ""}`
              : interrupted
                ? "未返回有效提示词"
                : "布局 · 文案 · 风格 · 产品要求"}
          </span>
          <button type="button" className="text-button" onClick={edit}>
            {text && !interrupted ? "编辑提示词 ↗" : "编写提示词 ↗"}
          </button>
        </div>
      )}
    </div>
  );
}
