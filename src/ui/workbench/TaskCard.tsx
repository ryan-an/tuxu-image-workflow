import type { ImageTask, ImageVersion } from "../types";
import { useState } from "react";
import { chosen, taskStatusInfo } from "../../../shared/model.js";
import { ActionButton, useApplication } from "../context.tsx";
import { currentProduct, formatTime } from "../selectors";
import { PromptPreview } from "./PromptPreview.tsx";
import { GenerationProgress } from "./GenerationProgress.tsx";
import { imageGeneration } from "../../view-models/image-generation.js";
import "./task-card.css";
import { ProductStatusBadge } from "../ProductStatusBadge";
import { Badge } from "../design-system/Badge";

export function VersionSelection({
  task,
  version,
}: {
  task: ImageTask;
  version: ImageVersion;
}) {
  const { controller } = useApplication();
  return (
    <input
      type="checkbox"
      data-action="select-version"
      data-task={task.id}
      data-version={version.id}
      checked={task.selectedIds.includes(version.id)}
      onChange={(e) => controller.changeField(e)}
    />
  );
}
function VersionHistory({ task }: { task: ImageTask }) {
  return (
    <div
      className="version-history result-switcher"
      role="group"
      aria-label={`${task.role}历史版本`}
      title={`历史 ${task.versions.length} 个版本 · 点击选用，勾选下载`}
    >
      {[...task.versions].reverse().map((v) => (
        <div
          key={v.id}
          className={`version ${v.id === task.primaryId ? "primary-version" : ""}`}
        >
          <ActionButton
            className="version-image"
            action="choose-version"
            data={{ task: task.id, version: v.id }}
            aria-pressed={v.id === task.primaryId}
            title={`点击选用 V${v.number} · ${v.origin === "demo" ? "演示图片" : formatTime(v.createdAt)}`}
          >
            <img
              src={v.source}
              alt={`V${v.number}`}
              loading="lazy"
              decoding="async"
            />
          </ActionButton>
          <div>
            <label title="加入本套下载">
              <VersionSelection task={task} version={v} /> V{v.number}
            </label>
          </div>
        </div>
      ))}
    </div>
  );
}
export function TaskCard({ task }: { task: ImageTask }) {
  const { state } = useApplication();
  const [referenceIndex, setReferenceIndex] = useState(0);
  const activeReference = Math.min(
    referenceIndex,
    Math.max(0, task.references.length - 1),
  );
  const result = chosen(task),
    status = taskStatusInfo(task, state.jobs, state.paused),
    busy = status.busy;
  const lastJob = [...state.jobs]
    .reverse()
    .find((j) => j.taskId === task.id || j.taskIds?.includes(task.id));
  const generation = imageGeneration(task.id, state.jobs, state.paused);
  const analysis = [...state.jobs]
    .reverse()
    .find((j) => j.kind === "prompt-set" && j.taskIds?.includes(task.id));
  const streaming =
    !!analysis && ["queued", "running"].includes(analysis.status);
  const interrupted =
    !!analysis && ["interrupted", "failed"].includes(analysis.status);
  const draft =
    streaming || interrupted ? analysis?.promptDrafts?.[task.role] || "" : "";
  return (
    <article className="task-card" data-task={task.id}>
      <div className="task-heading">
        <div className="task-title">
          <strong>{task.role}</strong>
          <ProductStatusBadge
            className="pill"
            tone={status.tone}
            label={status.label}
            title={
              interrupted
                ? analysis?.error || "未能获得完整的提示词"
                : undefined
            }
          />
        </div>
        <div className="task-card-controls">
          <ActionButton
            className="text-button"
            action="ask-doubao"
            data={{ task: task.id }}
            title="携带产品资料、提示词和结果图咨询豆包"
          >
            问豆包
          </ActionButton>
          <ActionButton
            className={`prompt-button ${task.prompt ? "has-prompt" : ""}`}
            action="edit-prompt"
            data={{ task: task.id }}
            title="展开编辑提示词"
          >
            {task.prompt && <i aria-label="已有提示词" />}提示词
          </ActionButton>
          <ActionButton
            className="card-generate-button"
            variant="primary"
            action="generate-image"
            data={{ task: task.id }}
            disabled={busy || streaming}
          >
            {task.versions.length ? "再生成" : "生成图片"}
          </ActionButton>
        </div>
      </div>
      <div className="image-comparison">
        <figure className="comparison-panel reference-panel">
          <figcaption>
            <strong>参考图</strong>
            <span>
              {task.references.length
                ? `${activeReference + 1} / ${task.references.length}`
                : "待添加"}
            </span>
          </figcaption>
          <ActionButton
            className="reference comparison-image"
            action="manage-references"
            data={{ task: task.id }}
            title="查看 / 管理参考图，完整显示原图"
          >
            {task.references[activeReference] ? (
              <>
                <img
                  src={task.references[activeReference]}
                  alt={`${task.role}参考图`}
                  loading="lazy"
                  decoding="async"
                />
                <span>查看 / 管理</span>
              </>
            ) : (
              <>
                <span className="plus">＋</span>
                <span>参考图</span>
              </>
            )}
          </ActionButton>
          {task.references.length > 0 && (
            <div
              className="reference-switcher"
              aria-label={`${task.role}参考图切换`}
            >
              {task.references.map((source, index) => (
                <button
                  key={`${source}-${index}`}
                  type="button"
                  aria-label={`查看参考图 ${index + 1}`}
                  aria-pressed={index === activeReference}
                  onClick={() => setReferenceIndex(index)}
                >
                  <img src={source} alt="" loading="lazy" decoding="async" />
                </button>
              ))}
            </div>
          )}
        </figure>
        <figure className="comparison-panel generated-panel">
          <figcaption>
            <strong>生成结果</strong>
            <span>
              {generation
                ? generation.label
                : result
                  ? `V${result.number} · 表格展示`
                  : "待生成"}
            </span>
          </figcaption>
          <div className={`result-area ${result ? "has-image" : ""}`}>
            {result ? (
              <ActionButton
                className="result-image"
                action="view-version"
                data={{ task: task.id, version: result.id }}
              >
                <img
                  src={result.source}
                  alt={`${task.role}当前选择结果`}
                  loading="lazy"
                  decoding="async"
                />
                <Badge tone="success" className="result-tag">
                  表格展示 · V{result.number}
                </Badge>
              </ActionButton>
            ) : !generation ? (
              <div className="result-placeholder">
                <span>◇</span>
                <strong>
                  {busy
                    ? streaming
                      ? "正在编写提示词…"
                      : "正在生成图片…"
                    : "等待生成结果"}
                </strong>
                {!!task.versions.length && (
                  <small>点击历史图片选为表格结果</small>
                )}
              </div>
            ) : null}
            {generation && (
              <GenerationProgress generation={generation} overlay={!!result} />
            )}
          </div>
          {!!task.versions.length && <VersionHistory task={task} />}
        </figure>
      </div>
      <div className="task-prompt-area">
        <PromptPreview
          text={draft || (!streaming ? task.prompt : "")}
          streaming={streaming}
          waiting={!task.prompt}
          interrupted={interrupted}
          failed={analysis?.status === "failed"}
          error={analysis?.error}
          validationFailed={
            !!analysis?.validationError ||
            (interrupted &&
              /文案不符合当前|文案遗漏|返回格式不正确|角色、布局或英文文案不完整|提示词必须包含/.test(
                analysis?.error || "",
              ))
          }
          unvalidated={!!draft}
          received={!!analysis?.receivedChars}
          taskId={task.id}
          productId={currentProduct(state)!.id}
        />
      </div>
      {lastJob?.status === "failed" && lastJob.kind !== "prompt-set" && (
        <div className="inline-error">
          {lastJob.error}
          <ActionButton
            className="text-button"
            action="retry-job"
            data={{ id: lastJob.id }}
          >
            重试
          </ActionButton>
        </div>
      )}
    </article>
  );
}
