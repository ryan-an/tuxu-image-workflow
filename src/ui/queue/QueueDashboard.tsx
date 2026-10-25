import { useJobHistory } from "../../application/use-job-history";
import { useQueueProgress } from "../../application/use-queue-progress";
import { useEffect, useState } from "react";
import type { Job } from "../types";
import type { QueueProgressRow } from "../../services/queue-progress";
import { needsQueueReconciliation } from "../../../shared/queue-progress.js";
import { queueJobWorking } from "../../../shared/job-status.js";
import { ActionButton, useApplication } from "../context.tsx";
import { ProductThumbnail } from "../products/Sidebar.tsx";
import { formatTime, statusNames, kindNames } from "../selectors";
import { ProductStatusBadge } from "../ProductStatusBadge.tsx";
import "./queue.css";
import { Badge } from "../design-system/Badge";
import { WorkspaceEmpty } from "../WorkspaceEmpty";
import { Button } from "../design-system/Button";
import { QueueManager } from "./QueueManager";

function QueueProductRow({
  product,
  info,
  retryable,
  recovery,
  active,
}: QueueProgressRow) {
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
          aria-label={`已选 ${info.picked} 张，共 ${product.tasks.length} 张`}
        >
          <strong className="queue-selected-count">{info.picked}</strong>
          <span>/ {product.tasks.length}</span>
        </div>
      </td>
      <td>
        <span className="queue-product-state">
          <ProductStatusBadge
            label={info.label}
            tone={info.tone}
            className="queue-product-status"
          />
          {info.label === "待重试" && !!retryable && (
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
  const { state, user, ui } = useApplication();
  const [tab, setTab] = useState("products");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [productPage, setProductPage] = useState(1);
  const [productFilter, setProductFilter] = useState("all");
  const [productSearch, setProductSearch] = useState("");
  const progress = useQueueProgress(
    state,
    productPage,
    productFilter,
    productSearch,
  );
  const summary = progress.data?.summary;
  useEffect(() => {
    if (!progress.loading && !progress.error && progress.data)
      setProductPage(progress.data.page);
  }, [progress.data?.page, progress.loading, progress.error]);
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
  const products = progress.products;
  const failedCount = summary?.failed || 0;
  const pendingCount = summary?.pending || 0;
  const interrupted = summary?.interrupted || 0;
  const completion = summary?.slots
    ? (summary.generated / summary.slots) * 100
    : 0;
  const canDownload =
    user.role === "viewer"
      ? state.products.some((product) =>
          product.tasks.some(
            (task) =>
              (ui.downloadSelections[task.id] || task.selectedIds).length,
          ),
        )
      : !!summary?.selected;
  const matchingJobs = history.jobs;
  function showProducts(status: string) {
    setProductFilter(status);
    setProductSearch("");
    setProductPage(1);
    setTab("products");
    progress.retry();
    if (status === "attention") {
      setFilter("attention");
      setPage(1);
    }
  }
  if (!state.products.length && !state.jobs.length)
    return <WorkspaceEmpty queue />;
  return (
    <div className="batch-queue">
      <div className="batch-queue-heading">
        <div>
          <h1>执行队列</h1>
          <span>
            当前工作区 · {summary?.products ?? state.products.length} 套产品
          </span>
        </div>
      </div>
      <section className="queue-overview" aria-label="全局统计">
        <div className="queue-overview-heading">
          <h2>全局统计</h2>
          <span>全部产品</span>
          {state.paused && <Badge tone="warning">队列已暂停</Badge>}
        </div>
        <div className="queue-metrics">
          <div className="queue-metric queue-metric--generated">
            <span className="queue-metric-label">已出图</span>
            <strong className="queue-metric-value" id="queue-generated">
              {summary?.generated ?? "—"}
              <span> / {summary?.slots ?? "—"} 张</span>
            </strong>
            <div
              className="queue-metric-progress"
              role="progressbar"
              aria-label="全局生成进度"
              aria-valuemin={0}
              aria-valuemax={summary?.slots || 1}
              aria-valuenow={summary?.generated || 0}
            >
              <i style={{ width: `${completion}%` }} />
            </div>
          </div>
          <Button
            className="queue-metric queue-metric--action"
            aria-label="查看图已齐的产品"
            aria-pressed={tab === "products" && productFilter === "complete"}
            onClick={() => showProducts("complete")}
          >
            <span className="queue-metric-label">图已齐</span>
            <strong className="queue-metric-value" id="queue-complete">
              {summary?.completeProducts ?? "—"}
              <span> / {summary?.products ?? "—"} 套</span>
            </strong>
            <span className="queue-metric-hint">
              {tab === "products" && productFilter === "complete"
                ? "已筛选"
                : "查看 →"}
            </span>
          </Button>
          <Button
            className="queue-metric queue-metric--action"
            aria-label="查看进行中的产品"
            title="含排队、分析和生图"
            aria-pressed={tab === "products" && productFilter === "active"}
            onClick={() => showProducts("active")}
          >
            <span className="queue-metric-label">进行中</span>
            <strong className="queue-metric-value" id="queue-working">
              {summary?.activeProducts ?? "—"}
              <span> 套</span>
            </strong>
            <span className="queue-metric-hint">
              {tab === "products" && productFilter === "active"
                ? "已筛选"
                : "查看 →"}
            </span>
          </Button>
          <Button
            className="queue-metric queue-metric--action queue-attention"
            aria-label="查看异常产品"
            aria-pressed={tab === "products" && productFilter === "attention"}
            title={`失败 ${failedCount} 项，中断 ${interrupted} 项`}
            onClick={() => showProducts("attention")}
          >
            <span className="queue-metric-label">有异常</span>
            <strong className="queue-metric-value" id="queue-attention">
              {summary?.attentionProducts ?? "—"}
              <span> 套</span>
            </strong>
            <span className="queue-metric-hint">
              {tab === "products" && productFilter === "attention"
                ? "已筛选"
                : "查看 →"}
            </span>
          </Button>
        </div>
      </section>
      <div className="queue-nav-row">
        <div className="queue-view-tabs" role="tablist" aria-label="队列视图">
          {[
            {
              id: "products",
              label: "产品进度",
              count: summary?.products ?? state.products.length,
            },
            {
              id: "jobs",
              label: "任务明细",
              count: state.jobTotal ?? state.jobs.length,
            },
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
                  !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                    event.key,
                  )
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
        {tab === "products" && (
          <div
            className="queue-product-toolbar"
            role="group"
            aria-label="队列操作"
          >
            <ActionButton
              action="download-batch-selected"
              variant="secondary"
              size="sm"
              disabled={!canDownload}
              title="下载当前工作区全部产品的选中图片"
            >
              下载选图
            </ActionButton>
            <QueueManager
              retryable={summary?.retryable || 0}
              pending={pendingCount}
            />
          </div>
        )}
      </div>
      {tab === "jobs" && (
        <section
          className="queue-job-details"
          role="tabpanel"
          id="queue-panel-jobs"
          aria-labelledby="queue-tab-jobs"
        >
          <div className="queue-detail-filter">
            <input
              aria-label="搜索队列任务"
              placeholder="搜索产品、卡片、平台 ID 或错误"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
            <label>
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
            <span role="status">
              {history.loading ? "更新中…" : `${history.total} 条记录`}
            </span>
          </div>
          <div className="queue-list" aria-busy={history.loading}>
            {matchingJobs.map((j) => (
              <JobRow key={j.id} job={j} />
            ))}
            {!history.loading && !history.error && !matchingJobs.length && (
              <div className="empty-page">
                {state.jobs.length
                  ? "没有符合条件的任务"
                  : "尚无执行记录，可在图片工作台发起生成。"}
              </div>
            )}
          </div>
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
          <div className="queue-detail-filter queue-product-filter">
            <input
              aria-label="搜索产品进度"
              placeholder="搜索产品名称或编号"
              value={productSearch}
              maxLength={500}
              onChange={(event) => {
                setProductSearch(event.target.value);
                setProductPage(1);
              }}
            />
            <label>
              <select
                aria-label="产品进度筛选"
                value={productFilter}
                onChange={(event) => {
                  setProductFilter(event.target.value);
                  setProductPage(1);
                }}
              >
                <option value="all">全部产品</option>
                <option value="missing">未出图</option>
                <option value="partial">未出齐</option>
                <option value="complete">图已齐</option>
                <option value="ready">待选图</option>
                <option value="selected">已选齐</option>
                <option value="active">进行中</option>
                <option value="attention">有异常</option>
              </select>
            </label>
            <span role="status">
              {progress.loading
                ? "更新中…"
                : `${progress.data?.total ?? "—"} 套产品`}
            </span>
          </div>
          {progress.error && (
            <div role="alert">
              {progress.error}{" "}
              <button type="button" onClick={progress.retry}>
                重试加载产品进度
              </button>
            </div>
          )}
          <div className="batch-queue-table-wrap" aria-busy={progress.loading}>
            <table className="batch-queue-table">
              <thead>
                <tr>
                  <th>产品</th>
                  <th>已出图</th>
                  <th>已选</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {products.map((row) => (
                  <QueueProductRow key={row.product.id} {...row} />
                ))}
                {!progress.loading && !progress.error && !products.length && (
                  <tr>
                    <td colSpan={5} className="empty-page">
                      {state.products.length
                        ? "没有符合条件的产品"
                        : "从表格解析产品，或添加产品后开始。"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <nav className="queue-history-pagination" aria-label="产品进度分页">
            <button
              type="button"
              disabled={progress.loading || productPage <= 1}
              onClick={() => setProductPage(productPage - 1)}
            >
              上一页
            </button>
            <span>
              当前第 {progress.data?.page ?? productPage} /{" "}
              {progress.data?.pages ?? 1} 页 · 每页 30 套 · 共{" "}
              {progress.data?.total ?? "—"} 套符合条件
            </span>
            <button
              type="button"
              disabled={
                progress.loading ||
                !progress.data ||
                productPage >= progress.data.pages
              }
              onClick={() => setProductPage(productPage + 1)}
            >
              下一页
            </button>
          </nav>
        </div>
      )}
    </div>
  );
}
