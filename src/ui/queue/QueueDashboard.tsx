import { useJobHistory } from "../../application/use-job-history";
import { useEffect, useState } from "react";
import type { Product, Job } from "../types";
import {
  latestQueueJobs,
  needsQueueReconciliation,
  productQueueInfo,
  queueJobWorking,
  remainingQueuePairs,
  retryableQueueJobs,
} from "../../view-models/queue-view.js";
import { ActionButton, useApplication } from "../context.tsx";
import { ProductThumbnail } from "../products/Sidebar.tsx";
import { formatTime, statusNames, kindNames } from "../selectors";
import { ProductStatusBadge } from "../ProductStatusBadge.tsx";
import "./queue.css";
import { Badge } from "../design-system/Badge";

function QueueProductRow({
  product,
  info,
  failures,
}: {
  product: Product;
  info: ReturnType<typeof productQueueInfo>;
  failures: Job[];
}) {
  const { state } = useApplication();
  const recovery = latestQueueJobs(state, product.id).find(
    (job) =>
      job.status === "interrupted" ||
      (job.status === "failed" && needsQueueReconciliation(job)),
  );
  const active = state.jobs.some(
    (job) =>
      job.productId === product.id &&
      ["queued", "running", "interrupted"].includes(job.status),
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
                width: `${product.tasks.length ? (info.generated / product.tasks.length) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      </td>
      <td>
        <div
          className="queue-image-counts"
          aria-label={`历史图 ${info.history}，已选 ${info.selected}`}
        >
          <strong>{info.history}</strong>
          <span aria-hidden="true">/</span>
          <strong className="queue-selected-count">{info.selected}</strong>
        </div>
      </td>
      <td>
        <span className="queue-product-state">
          <ProductStatusBadge
            label={info.label}
            tone={info.tone}
            className="queue-product-status"
          />
          {info.label === "待重试" && !!failures.length && (
            <ActionButton
              className="status-retry-button"
              action="retry-product-failed"
              data={{ id: product.id }}
              aria-label={`重试${product.name}的失败任务`}
              title="重试本产品失败任务"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <path
                  d="M20 7v5h-5M4 17v-5h5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 17.9 17"
                  strokeLinecap="round"
                />
              </svg>
            </ActionButton>
          )}
        </span>
      </td>
      <td>
        <div className="queue-product-row-actions">
          <ActionButton
            className="result-action-button"
            action="queue-open-product"
            data={{ id: product.id }}
          >
            查看 / 选图 →
          </ActionButton>
          {recovery && (
            <ActionButton
              action={
                recovery.remoteId
                  ? "query-job"
                  : needsQueueReconciliation(recovery)
                    ? "reconcile-job"
                    : "retry-job"
              }
              data={{ id: recovery.id }}
            >
              {recovery.remoteId
                ? "继续查询"
                : needsQueueReconciliation(recovery)
                  ? "核对平台"
                  : "恢复任务"}
            </ActionButton>
          )}
          {active && (
            <ActionButton
              className="text-button queue-stop"
              action="cancel-product-jobs"
              data={{ id: product.id }}
            >
              终止本套
            </ActionButton>
          )}
        </div>
      </td>
    </tr>
  );
}
function JobRow({ job }: { job: Job }) {
  const { state } = useApplication();
  const dependency = state.jobs.find((parent) => parent.id === job.dependsOn);
  const blocked = !!dependency && dependency.status !== "completed";
  const working = queueJobWorking(job);
  const status = working ? "running" : job.status;
  const model =
    job.mode === "demo"
      ? "演示模式"
      : job.kind === "prompt-set"
        ? job.config?.promptModel
        : job.config?.imageModel;
  const progress = Math.min(100, Math.max(0, job.progress || 0));
  return (
    <article className={`queue-row queue-card--${status}`} data-job={job.id}>
      <div className="queue-card-content">
        <div className="queue-card-heading">
          <h3>
            {job.productName}
            <span aria-hidden="true"> / </span>
            {job.role}
          </h3>
          <ProductStatusBadge
            className={`queue-status ${status}`}
            tone={status}
            label={
              working
                ? job.kind === "prompt-set"
                  ? "分析中"
                  : "生成中"
                : job.status === "queued" && blocked
                  ? "等待分析"
                  : job.status === "queued" && state.paused
                    ? "已暂停"
                    : statusNames[job.status]
            }
          />
        </div>
        <div className="queue-card-meta">
          <span>{kindNames[job.kind] || job.kind}</span>
          {model && <span>{model}</span>}
          {job.createdBy && <span>发起人：{job.createdBy.displayName}</span>}
          <time dateTime={new Date(job.createdAt).toISOString()}>
            {formatTime(job.createdAt)}
          </time>
        </div>
        {job.remoteId && (
          <div className="queue-card-remote">
            <span>平台 ID</span>
            <code>{job.remoteId}</code>
          </div>
        )}
        {working && (
          <div className="queue-card-progress">
            <span>
              {job.kind === "prompt-set" || job.stage === "prompt"
                ? `正在分析 ${job.taskIds?.length || "所选"} 张提示词…`
                : progress
                  ? `图片生成进度 ${progress}%`
                  : job.remoteId
                    ? "已提交平台，等待返回结果…"
                    : "正在提交生图请求…"}
            </span>
            {job.kind !== "prompt-set" && progress > 0 && (
              <div
                className="queue-card-progress-track"
                role="progressbar"
                aria-label="图片生成进度"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
              >
                <i style={{ width: `${progress}%` }} />
              </div>
            )}
          </div>
        )}
        {job.error && (
          <div
            className={`queue-card-message ${["failed", "interrupted"].includes(job.status) ? "is-error" : ""}`}
          >
            <strong>
              {job.status === "failed"
                ? "失败原因"
                : job.status === "interrupted"
                  ? "需要核对"
                  : "任务说明"}
            </strong>
            <p>{job.error}</p>
          </div>
        )}
        {blocked && ["failed", "queued"].includes(job.status) && (
          <p className="queue-card-hint">等待上游提示词分析完成后继续生图。</p>
        )}
        {job.syncError && (
          <div className="queue-card-message is-error">
            <strong>表格回填失败</strong>
            <p>{job.syncError}</p>
          </div>
        )}
      </div>
    </article>
  );
}
export function QueueDashboard() {
  const { state, controller, user, ui } = useApplication();
  const [tab, setTab] = useState("products");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const history = useJobHistory(
    state.jobs,
    state.settings.mode === "demo",
    tab === "jobs",
    page,
    filter,
    search,
  );
  useEffect(() => {
    if (!history.loading && !history.error && tab === "jobs")
      setPage(history.page);
  }, [history.page, history.loading, history.error, tab]);
  const products = state.products.map((product) => ({
    product,
    info: productQueueInfo(state, product),
  }));
  const sum = (field: "generated" | "history" | "selected") =>
      products.reduce((n, p) => n + p.info[field], 0),
    failed = retryableQueueJobs(state);
  const latest = latestQueueJobs(state);
  const failedCount = latest.filter((job) => job.status === "failed").length;
  const workingCount = state.jobs.filter(queueJobWorking).length;
  const pendingCount = state.jobs.filter(
    (job) => job.status === "queued" && !job.remoteId,
  ).length;
  const interrupted = state.jobs.filter(
      (j) => j.status === "interrupted",
    ).length,
    remaining = remainingQueuePairs(state).length;
  const matchingJobs = history.jobs;
  return (
    <div className="batch-queue">
      <div className="batch-queue-heading">
        <div>
          <h1>执行队列</h1>
          <span>
            {products.length} 套产品 ·{" "}
            {state.products.reduce((n, p) => n + p.tasks.length, 0)} 个图片位置
          </span>
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
            执行中 <strong>{workingCount}</strong>
          </span>
          <span>
            待执行 <strong>{pendingCount}</strong>
          </span>
          <span>
            失败 <strong>{failedCount}</strong>
          </span>
          <span>
            已选图片 <strong id="queue-selected">{sum("selected")}</strong>
          </span>
        </div>
        <span>
          {state.paused
            ? "已暂停后续请求；继续后自动处理未完成任务"
            : "可边生成边选图；已在队列中的位置不会重复加入"}
        </span>
      </div>
      {!!(interrupted || failedCount) && (
        <div
          className="queue-attention"
          role="region"
          aria-label="异常任务提醒"
        >
          <svg
            className="queue-attention-icon"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            aria-hidden="true"
          >
            <path d="M10.3 4.8 2.7 18a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 4.8a2 2 0 0 0-3.4 0Z" />
            <path d="M12 9v5m0 3v.5" strokeLinecap="round" />
          </svg>
          <div className="queue-attention-copy">
            <strong>
              {[
                failedCount ? `${failedCount} 个任务失败` : "",
                interrupted ? `${interrupted} 个任务中断` : "",
              ]
                .filter(Boolean)
                .join("，")}
            </strong>
            <p>在产品进度中处理失败与中断任务；此处可查看异常记录。</p>
          </div>
          <button
            className="queue-attention-button"
            type="button"
            onClick={() => {
              setFilter("attention");
              setPage(1);
              setTab("jobs");
            }}
          >
            查看异常任务
            <span aria-hidden="true">→</span>
          </button>
        </div>
      )}
      <div className="queue-view-tabs" role="tablist" aria-label="队列视图">
        {[
          { id: "products", label: "产品进度", count: products.length },
          { id: "jobs", label: "任务明细", count: state.jobs.length },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`queue-tab-${item.id}`}
            aria-controls={`queue-panel-${item.id}`}
            aria-selected={tab === item.id}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setTab(item.id)}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? "products"
                  : event.key === "End"
                    ? "jobs"
                    : tab === "products"
                      ? "jobs"
                      : "products";
              setTab(next);
              document.getElementById(`queue-tab-${next}`)?.focus();
            }}
          >
            {item.label}{" "}
            <Badge tone={tab === item.id ? "brand" : "neutral"}>
              {item.count}
            </Badge>
          </button>
        ))}
      </div>
      {tab === "jobs" && (
        <section
          className="queue-job-details"
          role="tabpanel"
          id="queue-panel-jobs"
          aria-labelledby="queue-tab-jobs"
        >
          <div className="queue-records-heading">
            <div>
              <h2>任务执行记录</h2>
              <p>查看进度和失败原因；重试、取消及并发设置请到产品进度。</p>
            </div>
            <span>仅查看</span>
          </div>
          <div className="queue-detail-filter">
            <label>
              任务筛选{" "}
              <select
                aria-label="任务状态"
                value={filter}
                onChange={(event) => {
                  setFilter(event.target.value);
                  setPage(1);
                }}
              >
                <option value="all">全部任务</option>
                <option value="active">执行中 / 待执行</option>
                <option value="attention">失败 / 待核对</option>
                <option value="completed">已完成</option>
                <option value="cancelled">已取消</option>
              </select>
            </label>
            <input
              aria-label="搜索队列任务"
              placeholder="搜索产品、卡片、平台 ID 或错误"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
            <span>{history.total} 条 · 按创建时间倒序</span>
          </div>
          <div className="queue-list" aria-busy={history.loading}>
            {matchingJobs.map((j) => (
              <JobRow key={j.id} job={j} />
            ))}
            {!history.loading && !history.error && !matchingJobs.length && (
              <div className="empty-page">
                {state.jobs.length
                  ? "没有符合条件的任务"
                  : "尚未加入任务，添加产品后即可批量生成。"}
              </div>
            )}
          </div>
          {history.loading && <p role="status">正在加载任务…</p>}
          {history.error && (
            <div role="alert">
              {history.error}{" "}
              <button type="button" onClick={history.retry}>
                重试加载
              </button>
            </div>
          )}
          <nav className="queue-history-pagination" aria-label="任务明细分页">
            <button
              type="button"
              disabled={history.loading || page <= 1}
              onClick={() => setPage(page - 1)}
            >
              上一页
            </button>
            <span>
              第 {history.page} / {history.pages} 页 · 每页 50 条 · 共{" "}
              {history.total} 条
            </span>
            <button
              type="button"
              disabled={history.loading || page >= history.pages}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </button>
          </nav>
        </section>
      )}
      {tab === "products" && (
        <div
          className="queue-products-panel"
          role="tabpanel"
          id="queue-panel-products"
          aria-labelledby="queue-tab-products"
        >
          <div
            className="queue-product-toolbar"
            role="group"
            aria-label="队列操作"
          >
            <ActionButton
              className="primary"
              action="generate-remaining"
              disabled={!remaining}
            >
              批量生成剩余{remaining > 0 ? `（${remaining} 张）` : ""}
            </ActionButton>
            <ActionButton
              action="pause-queue"
              title="暂停后不再发起新的执行请求；平台已受理的任务可能继续生成"
            >
              {state.paused ? "继续队列" : "暂停队列"}
            </ActionButton>
            <ActionButton
              action="retry-failed"
              disabled={!failed.length}
              title={
                failedCount > failed.length
                  ? "仅重试可恢复任务，其余需核对平台或处理上游分析"
                  : undefined
              }
            >
              重试失败{failed.length ? `（${failed.length}）` : ""}
            </ActionButton>
            <ActionButton
              action="cancel-pending"
              disabled={!pendingCount}
              title="仅取消尚未提交平台的待执行任务"
            >
              取消待执行
            </ActionButton>
            <label className="queue-concurrency">
              并发{" "}
              <select
                id="concurrency"
                value={state.concurrency}
                disabled={user.role !== "owner"}
                onChange={controller.changeField}
              >
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <ActionButton
              className="queue-download-selected result-action-button"
              action="download-batch-selected"
              disabled={
                user.role === "viewer"
                  ? !state.products.some((product) =>
                      product.tasks.some(
                        (task) =>
                          (ui.downloadSelections[task.id] || task.selectedIds)
                            .length,
                      ),
                    )
                  : !sum("selected")
              }
            >
              保存选中图片
            </ActionButton>
          </div>
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
                      failures={failed.filter(
                        (job) => job.productId === product.id,
                      )}
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
        </div>
      )}
    </div>
  );
}
