import { ActionButton, useApplication } from "../context.tsx";
import { currentProduct } from "../selectors";
import { useRef, useState } from "react";

export function SuitePromptButton({
  primary = false,
  action = "generate-prompt",
}: {
  primary?: boolean;
  action?: string;
}) {
  const { state } = useApplication();
  const product = currentProduct(state);
  const [mode, setMode] = useState("prompt");
  const menu = useRef<HTMLDetailsElement>(null);
  const analyses = state.jobs.filter(
    (job) => job.productId === product?.id && job.kind === "prompt-set",
  );
  const active = analyses.some((job) =>
    ["queued", "running"].includes(job.status),
  );
  const ready =
    !active &&
    !!product?.tasks.length &&
    product.tasks.every((task) => task.prompt.trim());
  const options = [
    {
      id: "prompt",
      label: "生成整套提示词",
      action,
      description: "统一分析整套参考图，生成全部提示词",
    },
    {
      id: "image",
      label: "一键生成本套图片",
      action: "batch-images",
      description: ready
        ? "使用现有提示词生成整套图片"
        : "整套提示词齐全后可用",
    },
    {
      id: "workflow",
      label: "执行本套工作流",
      action: "batch-workflow",
      description: "先生成整套提示词，完成后自动生成本套全部图片",
    },
  ];
  const selected = options.find((option) => option.id === mode)!;
  const generating = state.jobs.some(
    (job) =>
      job.productId === product?.id &&
      job.kind === "image" &&
      ["queued", "running"].includes(job.status),
  );
  const interrupted = analyses.find((job) => job.status === "interrupted");
  return (
    <div className="suite-action-control">
      <ActionButton
        className={primary ? "primary" : undefined}
        action={
          active
            ? "cancel-product-analysis"
            : interrupted
              ? "reconcile-job"
              : selected.action
        }
        data={
          active
            ? { id: product?.id }
            : interrupted
              ? { id: interrupted.id }
              : {}
        }
        title={active ? "点击终止当前产品的提示词生成" : selected.description}
        disabled={!active && (generating || (mode === "image" && !ready))}
      >
        {(active || generating) && (
          <span className="status-spinner" aria-hidden="true" />
        )}
        {active
          ? "生成整套提示词中，点击终止"
          : interrupted
            ? "提示词生成中断，核对后重试"
            : generating
              ? "本套图片生成中"
              : selected.label}
      </ActionButton>
      <details
        className="suite-action-menu"
        ref={menu}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            event.currentTarget.open = false;
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.currentTarget.open = false;
            event.currentTarget.querySelector("summary")?.focus();
          }
        }}
      >
        <summary aria-label="切换生成操作" title="切换生成操作">
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="m4 6 4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </summary>
        <div
          className="suite-action-options"
          role="group"
          aria-label="生成操作"
        >
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              className={mode === option.id ? "is-selected" : ""}
              aria-pressed={mode === option.id}
              disabled={option.id === "image" && !ready}
              title={option.description}
              onClick={() => {
                setMode(option.id);
                if (menu.current) {
                  menu.current.open = false;
                  menu.current.querySelector("summary")?.focus();
                }
              }}
            >
              <span>{option.label}</span>
              <small>{option.description}</small>
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}
