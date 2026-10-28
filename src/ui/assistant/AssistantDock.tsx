import { useEffect, useRef, useState } from "react";
import { ActionButton, useApplication } from "../context.tsx";
import { StatusSpinner } from "../StatusSpinner.tsx";
import { useAssistantConversation } from "./useAssistantConversation";
import type { AssistantTurn } from "../../services/assistant";
import doubaoLogo from "../../assets/doubao-logo.png";
import { AssistantMarkdown } from "./AssistantMarkdown";
import { AssistantContext } from "./AssistantContext";
import "./assistant.css";

function DoubaoLogo() {
  return (
    <img className="doubao-logo" src={doubaoLogo} alt="" aria-hidden="true" />
  );
}

export function AssistantDock() {
  const { ui } = useApplication();
  return (
    <>
      {!ui.assistant.open && (
        <ActionButton
          id="assistant-launcher"
          className="assistant-launcher"
          action="open-assistant"
        >
          <DoubaoLogo />
          豆包
        </ActionButton>
      )}
      <AssistantPanel
        key={`${ui.assistant.productId || "general"}:${ui.assistant.taskId || "all"}`}
      />
    </>
  );
}

function AssistantPanel() {
  const { state, ui, controller, isRemote, user } = useApplication();
  const canManageKeys = user.role === "owner";
  const context = ui.assistant;
  const product = state.products.find((p) => p.id === context.productId);
  const task = product?.tasks.find((t) => t.id === context.taskId);
  const result =
    task?.versions.find((v) => v.id === task.primaryId) ||
    task?.versions.at(-1);
  const chat = useAssistantConversation(context, isRemote, controller.flush);
  const {
    conversation,
    messages,
    draft,
    setDraft,
    pending,
    loading,
    error,
    setError,
    errorAction,
    setErrorAction,
    notice,
  } = chat;
  const [copied, setCopied] = useState<number | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const followReply = useRef(true);
  const input = useRef<HTMLTextAreaElement>(null);
  const lastText = messages.at(-1)?.content;
  const streaming = pending && messages.at(-1)?.role === "assistant";
  useEffect(() => {
    if (context.open) followReply.current = true;
  }, [context.open, conversation?.id]);
  useEffect(() => {
    if (followReply.current)
      scroll.current?.scrollTo({
        top: scroll.current.scrollHeight,
        behavior: "instant",
      });
  }, [messages.length, lastText, pending, context.open]);
  useEffect(() => {
    if (context.open) input.current?.focus();
  }, [context.open]);

  async function send(value = draft, retry?: AssistantTurn) {
    if (pending || loading || !value.trim()) return;
    if (!ui.hasPromptKey) {
      if (canManageKeys) await controller.dispatch("api-keys");
      return;
    }
    followReply.current = true;
    await chat.send(value, retry);
  }
  const missingContext =
    !!context.productId && (!product || (!!context.taskId && !task));
  return (
    <>
      <aside
        id="assistant-panel"
        className="assistant-panel"
        hidden={!context.open}
        role="dialog"
        aria-modal="false"
        aria-label="豆包"
        onKeyDown={(event) => {
          if (event.key === "Escape")
            void controller.dispatch("close-assistant");
        }}
      >
        <header className="assistant-header">
          <div className="assistant-avatar">
            <DoubaoLogo />
          </div>
          <div>
            <strong>豆包</strong>
            <small>
              <i />
              {pending
                ? streaming
                  ? "正在回复…"
                  : "正在思考你的问题…"
                : "一起把图片与提示词做好"}
            </small>
          </div>
          <ActionButton
            action="close-assistant"
            className="assistant-minimize"
            title="收起对话"
            aria-label="收起对话"
          >
            −
          </ActionButton>
        </header>
        <AssistantContext product={product} task={task} result={result} />
        <div
          className="assistant-messages"
          ref={scroll}
          role="log"
          aria-label="对话记录"
          aria-live="polite"
          onScroll={() => {
            const element = scroll.current;
            if (element)
              followReply.current =
                element.scrollHeight -
                  element.scrollTop -
                  element.clientHeight <
                80;
          }}
        >
          {loading && !messages.length && (
            <div className="assistant-thinking" role="status">
              <StatusSpinner />
              正在读取这张卡片的对话记录…
            </div>
          )}
          {!loading && !messages.length && (
            <div className="assistant-welcome">
              <span>你好，我是豆包。</span>
              <h3>这张图，哪里还能更好？</h3>
              <p>
                聊聊产品表达、版式文案，或把你的想法变成更准确的生图提示词。
              </p>
              <div className="assistant-suggestions">
                {[
                  task
                    ? "结合生成结果，指出当前提示词可以改进的地方"
                    : "帮我检查这套图片的产品表达和设计风格",
                  "帮我优化当前提示词，给出可以直接复制的完整版本",
                ].map((question) => (
                  <button
                    key={question}
                    type="button"
                    disabled={pending || loading || !isRemote || missingContext}
                    onClick={() => void send(question)}
                  >
                    {question}
                    <span>↗</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((message, index) => (
            <div
              className={`assistant-message ${message.role}`}
              key={`${message.turn.id}:${message.role}`}
            >
              <small>
                {message.role === "assistant" ? (
                  <>
                    <DoubaoLogo />
                    豆包
                  </>
                ) : (
                  "你"
                )}
              </small>
              {message.role === "assistant" ? (
                <AssistantMarkdown text={message.content} />
              ) : (
                <div>{message.content}</div>
              )}
              {message.role === "assistant" &&
                !["running", "completed"].includes(message.turn.status) && (
                  <div className="assistant-turn-status">部分回复 · 已保存</div>
                )}
              {message.role === "user" &&
                !["running", "completed"].includes(message.turn.status) && (
                  <div
                    className="assistant-turn-status"
                    title={message.turn.error}
                  >
                    {message.turn.status === "failed"
                      ? "回复失败"
                      : message.turn.status === "interrupted"
                        ? "回复中断"
                        : "已停止回复"}{" "}
                    · 问题已保存
                    <button
                      type="button"
                      disabled={pending || loading}
                      onClick={() => void send(message.content, message.turn)}
                    >
                      重试这条问题
                    </button>
                  </div>
                )}
              {message.role === "assistant" && (
                <button
                  type="button"
                  className="assistant-copy"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(message.content);
                      setCopied(index);
                    } catch {
                      setErrorAction(undefined);
                      setError("复制失败，请选中回复文字手动复制");
                    }
                  }}
                >
                  {copied === index ? "已复制" : "复制回复"}
                </button>
              )}
            </div>
          ))}
          {pending && (
            <div className="assistant-thinking" role="status">
              <StatusSpinner />
              {streaming ? "正在回复…" : "豆包正在查看资料并组织回复…"}
            </div>
          )}
        </div>
        {!ui.hasPromptKey && (
          <div className="assistant-banner">
            {canManageKeys ? (
              <>
                先配置豆包 API Key，即可开始对话。
                <ActionButton action="api-keys">填写密钥</ActionButton>
              </>
            ) : (
              "请联系所有者配置豆包服务后开始对话。"
            )}
          </div>
        )}
        {!isRemote && (
          <div className="assistant-banner">请在正式工作台使用豆包对话。</div>
        )}
        {missingContext && (
          <div className="assistant-banner">
            原产品或卡片已删除，请重新选择咨询对象。
          </div>
        )}
        {error && (
          <div className="assistant-error" role="alert">
            {error}
            {!errorAction && (
              <button type="button" onClick={() => void chat.reload()}>
                重新读取记录
              </button>
            )}
            {errorAction === "open-model" && canManageKeys && (
              <a
                href="https://ark.volcengine.com/region:cn-beijing/openManagement"
                target="_blank"
                rel="noreferrer"
              >
                前往火山方舟开通模型 ↗
              </a>
            )}
            {errorAction && !canManageKeys && (
              <span>请联系所有者检查豆包服务和对话模型配置。</span>
            )}
            {errorAction && canManageKeys && (
              <ActionButton
                action={errorAction === "check-key" ? "api-keys" : "settings"}
              >
                {errorAction === "check-key"
                  ? "检查豆包密钥"
                  : "更换已开通的模型"}
              </ActionButton>
            )}
          </div>
        )}
        {notice && (
          <div className="assistant-notice" role="status">
            {notice}
          </div>
        )}
        <form
          className="assistant-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <textarea
            ref={input}
            aria-label="发给豆包的消息"
            placeholder="描述你想调整的地方…"
            value={draft}
            maxLength={16000}
            rows={2}
            disabled={pending || loading || !isRemote || missingContext}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <div>
            <button
              type="button"
              className="assistant-clear"
              aria-label="清空对话历史"
              title={`清空${task ? "当前卡片" : product ? "当前产品咨询" : "通用咨询"}的全部对话历史`}
              disabled={
                pending ||
                loading ||
                !isRemote ||
                !chat.hasHistory ||
                missingContext
              }
              onClick={() => {
                setCopied(null);
                void chat.clearHistory();
              }}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" />
              </svg>
              清空对话
            </button>
            <small>Enter 发送 · Shift + Enter 换行</small>
            {pending ? (
              <button
                key="stop"
                type="button"
                className="assistant-action assistant-stop"
                aria-label="停止回复"
                title="停止回复"
                onClick={(event) => {
                  event.preventDefault();
                  void chat.stop();
                }}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <rect x="5" y="5" width="14" height="14" rx="2" />
                </svg>
              </button>
            ) : (
              <button
                key="send"
                type="submit"
                className="assistant-action assistant-send"
                aria-label="发送消息"
                title="发送消息"
                disabled={
                  !draft.trim() || loading || !isRemote || missingContext
                }
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 19V5M6 11l6-6 6 6" />
                </svg>
              </button>
            )}
          </div>
        </form>
      </aside>
    </>
  );
}
