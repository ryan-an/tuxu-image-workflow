import { useEffect, useRef, useState } from "react";
import { ActionButton } from "../context.tsx";
export function PromptPreview({
  text,
  streaming,
  waiting,
  interrupted,
  received,
  taskId,
  error,
  failed,
  recovery,
  unvalidated,
}: {
  text: string;
  streaming: boolean;
  waiting: boolean;
  interrupted: boolean;
  received: boolean;
  taskId: string;
  error?: string;
  failed?: boolean;
  recovery?: { id: string; action: string };
  unvalidated?: boolean;
}) {
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
    if (follow.current && viewport.current)
      viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [visible]);
  return (
    <div
      className={`prompt-preview ${streaming ? "is-streaming" : ""} ${interrupted ? "has-prompt-error" : ""}`}
    >
      <div className="prompt-preview-heading">
        <span className="prompt-state-dot" />
        <strong>
          {interrupted
            ? failed
              ? "分析失败"
              : "分析中断"
            : streaming
              ? received
                ? "正在编写提示词"
                : "等待平台响应"
              : waiting
                ? "等待提示词"
                : "提示词已就绪"}
        </strong>
        <small>{streaming ? "实时输出" : "PROMPT"}</small>
      </div>
      <div
        className="prompt-preview-body"
        ref={viewport}
        onScroll={(event) => {
          const el = event.currentTarget;
          follow.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {interrupted && (
          <div className="prompt-error" role="alert">
            <strong>{failed ? "本次分析失败" : "本次分析已中断"}</strong>
            <p>{error || "未能获得完整的分析结果"}</p>
            {recovery && (
              <ActionButton
                className="text-button"
                action={recovery.action}
                data={{ id: recovery.id }}
              >
                {recovery.action === "reconcile-job"
                  ? "核对后重新分析 ↗"
                  : "重新分析 ↗"}
              </ActionButton>
            )}
          </div>
        )}
        {visible ? (
          <div className="prompt-preview-text">
            {visible}
            {streaming && <span className="typing-caret" aria-hidden="true" />}
          </div>
        ) : !interrupted ? (
          <div className="prompt-waiting">
            <span className="prompt-waiting-icon">✦</span>
            <strong>
              {streaming
                ? received
                  ? "正在统一整套设计"
                  : "等待平台返回分析内容"
                : "从参考图开始，形成这张图的提示词"}
            </strong>
            <p>
              {streaming
                ? "该位置的文字返回后会在这里逐字呈现"
                : "点击上方生成整套提示词，或直接编写"}
            </p>
          </div>
        ) : null}
      </div>
      <div className="prompt-preview-footer">
        <span>
          {text
            ? `${text.length} 字符${streaming || unvalidated ? " · 未校验草稿" : ""}`
            : interrupted
              ? "未返回有效提示词"
              : "布局 · 文案 · 风格 · 产品要求"}
        </span>
        {!streaming && (
          <ActionButton
            className="text-button"
            action="edit-prompt"
            data={{ task: taskId }}
          >
            {text && !interrupted ? "编辑提示词 ↗" : "编写提示词 ↗"}
          </ActionButton>
        )}
      </div>
    </div>
  );
}
