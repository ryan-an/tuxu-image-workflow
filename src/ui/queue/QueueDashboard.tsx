import type { Product, Job } from "../types";
import { productQueueInfo, retryableQueueJobs } from "../../queue-view.js";
import { ActionButton, useApplication } from "../context.tsx";
import { ProductThumbnail } from "../products/Sidebar.tsx";
import { formatTime, statusNames, kindNames } from "../selectors";
import { StatusSpinner } from "../StatusSpinner.tsx";

function QueueProductRow({
  product,
  info,
}: {
  product: Product;
  info: ReturnType<typeof productQueueInfo>;
}) {
  const { state } = useApplication();
  const active = state.jobs.some(
    (job) =>
      job.productId === product.id &&
      ["queued", "running"].includes(job.status),
  );
  return (
    <tr data-product-row={product.id}>
      <td>
        <div className="queue-product">
          <span
            className="queue-product-thumbnail"
            data-thumbnail-for={product.id}
          >
            <ProductThumbnail product={product} size={38} />
          </span>
          <div>
            <strong>{product.name}</strong>
            <small>{product.code}</small>
          </div>
        </div>
      </td>
      <td>
        <div className="queue-product-progress">
          <span>
            {info.generated} / {product.tasks.length}
          </span>
          <div
            className="queue-progress-track"
            role="progressbar"
            aria-label={`${product.name}生成进度`}
            aria-valuemin={0}
            aria-valuemax={product.tasks.length}
            aria-valuenow={info.generated}
          >
            <i
              style={{
                width: `${(info.generated / product.tasks.length) * 100}%`,
              }}
            />
          </div>
        </div>
      </td>
      <td>
        {info.history} / {info.selected}
      </td>
      <td>
        <span className={`queue-product-status ${info.tone}`}>
          {info.tone === "working" && <StatusSpinner />}
          {info.label}
        </span>
      </td>
      <td>
        <ActionButton action="queue-open-product" data={{ id: product.id }}>
          查看 / 选图 →
        </ActionButton>
        {active && (
          <ActionButton
            className="text-button queue-stop"
            action="cancel-product-jobs"
            data={{ id: product.id }}
          >
            终止本套
          </ActionButton>
        )}
      </td>
    </tr>
  );
}
function JobRow({ job }: { job: Job }) {
  const retryAction = job.remoteId
    ? "query-job"
    : job.stage && !["pending", "completed"].includes(job.stage)
      ? "reconcile-job"
      : "retry-job";
  return (
    <div className="queue-row" data-job={job.id}>
      <span className={`queue-status ${job.status}`}>
        {job.status === "running" && <StatusSpinner />}
        {job.status === "running"
          ? job.kind === "prompt-set"
            ? "分析中"
            : "生成中"
          : statusNames[job.status]}
      </span>
      <div>
        <strong>
          {job.productName} · {job.role}
        </strong>
        <p>
          {kindNames[job.kind] || job.kind} ·{" "}
          {job.mode === "demo"
            ? "演示"
            : job.kind === "prompt-set"
              ? job.config?.promptModel
              : job.config?.imageModel || "Grsai"}{" "}
          {job.remoteId && `· 平台 ID ${job.remoteId}`}
        </p>
        {job.error && <p className="error-text">{job.error}</p>}
        {job.syncError && (
          <p className="error-text">表格回填：{job.syncError}</p>
        )}
      </div>
      <small>
        {job.status === "running"
          ? job.kind === "prompt-set" || job.stage === "prompt"
            ? "生成整套提示词…"
            : `生成图片 ${job.progress || 0}%`
          : formatTime(job.createdAt)}
      </small>
      {["queued", "running", "interrupted"].includes(job.status) && (
        <ActionButton action="cancel-job" data={{ id: job.id }}>
          {job.status === "running" ? "终止任务" : "取消"}
        </ActionButton>
      )}
      {["failed", "cancelled", "interrupted"].includes(job.status) && (
        <ActionButton action={retryAction} data={{ id: job.id }}>
          {retryAction === "query-job"
            ? "继续查询"
            : retryAction === "reconcile-job"
              ? "核对平台"
              : "重试"}
        </ActionButton>
      )}
    </div>
  );
}
export function QueueDashboard() {
  const { state, controller } = useApplication();
  const products = state.products.map((product) => ({
    product,
    info: productQueueInfo(state, product),
  }));
  const sum = (field: "generated" | "history" | "selected") =>
      products.reduce((n, p) => n + p.info[field], 0),
    failed = retryableQueueJobs(state);
  const interrupted = state.jobs.filter(
      (j) => j.status === "interrupted",
    ).length,
    remaining = state.products
      .flatMap((p) => p.tasks)
      .filter((t) => !t.versions.length).length;
  return (
    <div className="batch-queue">
      <div className="batch-queue-heading">
        <div>
          <h1>批量队列</h1>
          <span>{products.length} 套产品 · 每套 10 张</span>
        </div>
        <div className="batch-queue-actions">
          <ActionButton action="pause-queue">
            {state.paused ? "继续队列" : "暂停队列"}
          </ActionButton>
          <ActionButton
            className="primary"
            action="generate-remaining"
            disabled={!remaining}
          >
            批量生成剩余
          </ActionButton>
        </div>
      </div>
      <div className="batch-queue-summary">
        <div>
          <span>
            图片任务{" "}
            <strong id="queue-generated">
              {sum("generated")} /{" "}
              {state.products.reduce((n, p) => n + p.tasks.length, 0)}
            </strong>
          </span>
          <span>
            历史图 <strong id="queue-history">{sum("history")}</strong>
          </span>
          <span>
            待重试 <strong>{failed.length}</strong>
          </span>
          <span>
            已选保存 <strong id="queue-selected">{sum("selected")}</strong>
          </span>
        </div>
        <span>按队列处理，可边生成边选图</span>
      </div>
      <div className="batch-queue-tools">
        <div>
          <ActionButton action="retry-failed" disabled={!failed.length}>
            重试失败任务
          </ActionButton>
          <span>{failed.length} 个</span>
        </div>
        <ActionButton
          action="download-batch-selected"
          disabled={!sum("selected")}
        >
          保存整批选中图片
        </ActionButton>
      </div>
      {!!interrupted && (
        <div className="notice">
          有 {interrupted} 个未完成任务。已有平台 ID 的任务继续查询原结果。
          <ActionButton action="resume-interrupted">恢复任务</ActionButton>
        </div>
      )}
      <div className="batch-queue-table-wrap">
        <table className="batch-queue-table">
          <thead>
            <tr>
              <th>产品</th>
              <th>生成进度</th>
              <th>历史图 / 已选</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {products.map(
              ({
                product,
                info,
              }: {
                product: Product;
                info: ReturnType<typeof productQueueInfo>;
              }) => (
                <QueueProductRow
                  key={product.id}
                  product={product}
                  info={info}
                />
              ),
            )}
            {!products.length && (
              <tr>
                <td colSpan={5} className="empty-page">
                  从表格解析产品，或添加产品后开始。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <details className="queue-job-details">
        <summary>
          任务明细 <span>{state.jobs.length} 条</span>
        </summary>
        <div className="queue-detail-controls">
          <label>
            同时执行{" "}
            <select
              id="concurrency"
              value={state.concurrency}
              onChange={controller.changeField}
            >
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>{" "}
            个
          </label>
          <ActionButton action="cancel-pending">取消待执行</ActionButton>
          <span>终止会中断本地请求；平台已受理的任务可能继续执行。</span>
        </div>
        <div className="queue-list">
          {[...state.jobs].reverse().map((j) => (
            <JobRow key={j.id} job={j} />
          ))}
          {!state.jobs.length && <div className="empty-page">尚未加入任务</div>}
        </div>
      </details>
    </div>
  );
}
