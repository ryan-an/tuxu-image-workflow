import { useEffect, useId, useRef, useState } from "react";
import { can } from "../../../shared/access";
import { ActionButton, useApplication } from "../context";
import { Button } from "../design-system/Button";

export function QueueManager({
  retryable,
  pending,
}: {
  retryable: number;
  pending: number;
}) {
  const { state, user } = useApplication();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    width: 256,
    maxHeight: 400,
  });
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event.target instanceof Node && panel.current?.contains(event.target))
        return;
      panel.current?.hidePopover();
    };
    window.addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", close, true);
    };
  }, [open]);
  if (!can(user.role, "edit")) return null;
  function positionPanel() {
    const rect = trigger.current!.getBoundingClientRect();
    const width = Math.min(256, window.innerWidth - 24);
    const height = Math.min(420, window.innerHeight - 24);
    setPosition({
      width,
      left: Math.max(
        12,
        Math.min(rect.right - width, window.innerWidth - width - 12),
      ),
      top: Math.max(
        12,
        Math.min(rect.bottom + 6, window.innerHeight - height - 12),
      ),
      maxHeight: height,
    });
  }
  return (
    <>
      <Button
        ref={trigger}
        variant="ghost"
        size="sm"
        popoverTarget={id}
        aria-haspopup="dialog"
        aria-controls={id}
        aria-expanded={open}
        onClick={positionPanel}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown") return;
          event.preventDefault();
          positionPanel();
          panel.current?.showPopover();
          panel.current
            ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
            ?.focus();
        }}
      >
        队列管理{" "}
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </Button>
      <div
        ref={panel}
        id={id}
        popover="auto"
        role="dialog"
        aria-label="全局队列管理"
        className="queue-manager-popover"
        style={position}
        onToggle={() =>
          setOpen(panel.current?.matches(":popover-open") || false)
        }
        onClick={(event) => {
          if (
            (event.target as Element).closest(
              "button[data-action]:not(:disabled)",
            )
          )
            panel.current?.hidePopover();
        }}
      >
        <div className="queue-manager-heading">
          <strong>全局队列管理</strong>
          <small>作用于当前工作区全部任务</small>
        </div>
        <div className="queue-manager-actions">
          <ActionButton
            action="pause-queue"
            variant="secondary"
            size="sm"
            title="暂停后不再发起新请求，平台已受理的任务可能继续生成"
          >
            {state.paused ? "继续队列" : "暂停队列"}
          </ActionButton>
          <ActionButton
            action="retry-failed"
            variant="secondary"
            size="sm"
            disabled={!retryable}
            title="仅重试可恢复的失败任务，受理状态未知的任务需要先核对平台"
          >
            重试失败{retryable ? `（${retryable}）` : ""}
          </ActionButton>
          <ActionButton
            action="cancel-pending"
            variant="danger"
            size="sm"
            disabled={!pending}
            title="仅取消尚未提交平台的待执行任务"
          >
            取消待执行{pending ? `（${pending}）` : ""}
          </ActionButton>
        </div>
      </div>
    </>
  );
}
