import type { ImageTask, ImageVersion } from "../types";
import { chosen, taskStatus } from "../../model.js";
import { ActionButton, useApplication } from "../context.tsx";
import { formatTime } from "../selectors";
import { PromptPreview } from "./PromptPreview.tsx";

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
    <>
      <div className="history-heading">
        <span>
          历史 <b>{task.versions.length}</b>
        </span>
        <small>点击选用 · 勾选下载</small>
      </div>
      <div className="version-history">
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
              <span
                className="version-marker"
                title={
                  v.id === task.primaryId
                    ? "当前表格展示版本"
                    : "点击缩略图选用"
                }
              />
            </div>
          </div>
        ))}
        {!task.versions.length && (
          <span className="empty-small">还没有历史版本</span>
        )}
      </div>
    </>
  );
}
export function TaskCard({ task }: { task: ImageTask }) {
  const { state } = useApplication();
  const result = chosen(task),
    status = taskStatus(task, state.jobs),
    busy = ["执行中", "排队中"].includes(status);
  const lastJob = [...state.jobs]
    .reverse()
    .find((j) => j.taskId === task.id || j.taskIds?.includes(task.id));
  const analysis = [...state.jobs]
    .reverse()
    .find((j) => j.kind === "prompt-set" && j.taskIds?.includes(task.id));
  const streaming =
    !!analysis && ["queued", "running"].includes(analysis.status);
  const interrupted =
    !!analysis && ["interrupted", "failed"].includes(analysis.status);
  const draft =
    streaming || interrupted ? analysis?.promptDrafts?.[task.role] || "" : "";
  const showPrompt = streaming || interrupted || !result;
  return (
    <article className="task-card" data-task={task.id}>
      <div className="task-heading">
        <ActionButton
          className="reference"
          action="manage-references"
          data={{ task: task.id }}
          title="查看 / 管理参考图"
        >
          {task.references[0] ? (
            <>
              <img
                src={task.references[0]}
                alt={`${task.role}参考图`}
                loading="lazy"
                decoding="async"
              />
              <span>
                参考
                {task.references.length > 1
                  ? ` · ${task.references.length}`
                  : ""}
              </span>
            </>
          ) : (
            <>
              <span className="plus">＋</span>
              <span>参考图</span>
            </>
          )}
        </ActionButton>
        <div className="task-title">
          <strong>{task.role}</strong>
          <span className={`pill ${busy ? "working" : result ? "done" : ""}`}>
            {streaming
              ? "提示词生成中"
              : interrupted
                ? analysis?.status === "failed"
                  ? "分析失败"
                  : "分析中断"
                : status}
          </span>
        </div>
        <div className="task-card-controls">
          <ActionButton
            className={`prompt-button ${task.prompt ? "has-prompt" : ""}`}
            action="edit-prompt"
            data={{ task: task.id }}
            title="查看 / 编辑提示词"
            disabled={streaming}
          >
            {task.prompt && <i aria-label="已有提示词" />}提示词
          </ActionButton>
          <ActionButton
            className="subtle-primary"
            action="generate-image"
            data={{ task: task.id }}
            disabled={busy || streaming}
          >
            {task.versions.length ? "再生成" : "生成图片"}
          </ActionButton>
        </div>
      </div>
      <div
        className={`result-area ${showPrompt ? "shows-prompt" : result ? "has-image" : ""}`}
      >
        {showPrompt ? (
          <PromptPreview
            text={draft || (!streaming ? task.prompt : "")}
            streaming={streaming}
            waiting={!task.prompt}
            interrupted={interrupted}
            failed={analysis?.status === "failed"}
            error={analysis?.error}
            unvalidated={!!draft}
            recovery={
              analysis
                ? {
                    id: analysis.id,
                    action:
                      analysis.status === "interrupted"
                        ? "reconcile-job"
                        : "retry-job",
                  }
                : undefined
            }
            received={!!analysis?.receivedChars}
            taskId={task.id}
          />
        ) : result ? (
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
            <span className="result-tag">表格展示 · V{result.number}</span>
          </ActionButton>
        ) : (
          <div className="result-placeholder">
            <span>◇</span>
            <strong>{busy ? "正在生成图片…" : "等待生成结果"}</strong>
            {!!task.versions.length && <small>点击历史图片选为表格结果</small>}
          </div>
        )}
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
      {(!showPrompt || !!task.versions.length) && (
        <VersionHistory task={task} />
      )}
    </article>
  );
}
