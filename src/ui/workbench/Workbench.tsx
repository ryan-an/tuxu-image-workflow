import { can } from "../../../shared/access";
import { hasSelectedVersion } from "../../../shared/model.js";
import {
  productPhotos,
  productRequirements,
} from "../../../shared/prompt-suite.js";
import { ActionButton, useApplication } from "../context.tsx";
import { currentProduct, productStats, selectedCount } from "../selectors";
import { TaskCard } from "./TaskCard.tsx";
import { SuitePromptButton } from "./SuitePromptButton.tsx";
import { WorkspaceTitle } from "./WorkspaceTitle.tsx";
import "./requirements.css";
import { Badge } from "../design-system/Badge";
import { PreviewImage } from "../PreviewImage";
import { WorkspaceLoading } from "../WorkspaceLoading";
import { WorkspaceEmpty, EmptyCollectionIcon } from "../WorkspaceEmpty";

export function Workbench() {
  const { state, ui, user } = useApplication(),
    product = currentProduct(state);
  if (!product) return <WorkspaceEmpty />;
  if (product._summary && !ui.productError)
    return <WorkspaceLoading product={product} />;
  if (product._summary)
    return (
      <div className="empty-page" role="status" aria-busy={!ui.productError}>
        <strong>{product.name}</strong>
        <p>{ui.productError || "正在加载产品图片和提示词…"}</p>
        {ui.productError && (
          <ActionButton action="open-product" data={{ id: product.id }}>
            重试加载
          </ActionButton>
        )}
      </div>
    );
  const stats = productStats(product),
    photoCount = productPhotos(product).length,
    requirements = productRequirements(product, state.common),
    tasks = product.tasks.filter(
      (t) =>
        ui.filter === "all" ||
        (ui.filter === "missing"
          ? !hasSelectedVersion(t)
          : ui.filter === "selected"
            ? hasSelectedVersion(t)
            : t.versions.length > 1),
    );
  return (
    <div className="workbench-ready" key={product.id}>
      <div className="page-heading">
        <div className="workspace-heading-text">
          <span className="eyebrow">PRODUCT WORKSPACE</span>
          <WorkspaceTitle key={product.id} name={product.name} />
          <p>
            {product.code} <span>·</span> {stats.done} 个位置已选结果，
            {stats.versions} 个历史版本
          </p>
        </div>
        <ActionButton
          action={!can(user, "edit") ? "view-product" : "edit-product"}
        >
          {!can(user, "edit") ? "查看产品" : "编辑产品"}
        </ActionButton>
      </div>
      <div className="product-context">
        <div className="product-setup">
          <section className="product-info" aria-label="产品资料">
            <ActionButton
              className="product-photo"
              action="upload-photo"
              aria-label={photoCount ? "查看产品实拍图" : "上传产品实拍图"}
            >
              {product.photo ? (
                <PreviewImage src={product.photo} alt="产品实拍" />
              ) : (
                "＋实拍"
              )}
            </ActionButton>
            <div className="product-details">
              <strong>产品资料</strong>
              <p title={product.facts || undefined}>
                {product.facts || "补充规格、材质、颜色等产品信息"}
              </p>
            </div>
            <ActionButton
              className="product-photos-button"
              action="manage-photos"
              aria-label={`实拍图 ${photoCount} 张`}
              title="查看、上传或管理产品实拍图"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <rect
                  x="5"
                  y="3"
                  width="16"
                  height="16"
                  rx="2"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path
                  d="M17 23H5a4 4 0 0 1-4-4V7M5 15l4-4 5 5 3-3 4 4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="16" cy="8" r="1.5" fill="currentColor" />
              </svg>
              <span>实拍图</span>
              <b>{photoCount} 张</b>
            </ActionButton>
          </section>
          <section
            className="product-requirements"
            aria-labelledby="product-requirements-title"
          >
            <div className="requirements-summary">
              <div className="requirements-summary-heading">
                <svg
                  className="requirements-icon"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5Z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M14 3v5h5M9 12h6M9 16h6"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
                <h2 id="product-requirements-title">整套提示词要求</h2>
                <Badge
                  tone={requirements === state.common ? "brand" : "info"}
                  className={`requirements-badge ${requirements !== state.common ? "customized" : ""}`}
                >
                  {requirements === state.common
                    ? "默认要求"
                    : "本产品已自定义"}
                </Badge>
              </div>
              <p>仅当前产品 · 修改后下次生成时生效</p>
            </div>
            <div className="requirements-actions">
              <ActionButton
                className="requirements-edit"
                action={
                  !can(user, "edit") ? "view-requirements" : "common-prompt"
                }
              >
                {!can(user, "edit") ? "查看要求" : "编辑要求"}
              </ActionButton>
              <SuitePromptButton key={product.id} primary />
            </div>
          </section>
        </div>
      </div>
      <div className="task-toolbar">
        <div className="segmented">
          {[
            ["all", "全部"],
            ["missing", "未选结果"],
            ["selected", "已选结果"],
            ["history", "多版历史"],
          ].map(([id, label]) => (
            <ActionButton
              key={id}
              action="filter-tasks"
              data={{ filter: id }}
              className={ui.filter === id ? "active" : ""}
            >
              {label}
            </ActionButton>
          ))}
        </div>
        <span className="download-guide">历史图片勾选仅用于本套下载</span>
        <span className="mode-label">
          {state.settings.mode === "demo"
            ? "演示生成"
            : `Grsai · ${state.settings.imageModel}`}
        </span>
      </div>
      <div className="task-grid">
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} />
        ))}
        {!tasks.length && (
          <div className="workspace-filter-empty">
            <EmptyCollectionIcon />
            <strong>当前筛选下还没有图片位置</strong>
            <p>切换到全部图片，继续查看这套产品。</p>
            <ActionButton
              action="filter-tasks"
              data={{ filter: "all" }}
              variant="secondary"
            >
              查看全部图片
            </ActionButton>
          </div>
        )}
      </div>
    </div>
  );
}
export function BatchBar() {
  const { state, ui, user } = useApplication(),
    product = currentProduct(state),
    count =
      !can(user, "edit")
        ? product?.tasks.reduce(
            (n, t) => n + (ui.downloadSelections[t.id] || t.selectedIds).length,
            0,
          ) || 0
        : selectedCount(product);
  return (
    <footer id="batch-bar" hidden={ui.view !== "workbench" || !product}>
      <div id="batch-label">
        <strong>当前产品 · 已勾选 {count} 张下载图片</strong>
        <span>勾选图片后下载，生成操作在顶部切换</span>
      </div>
      <div>
        <ActionButton
          id="download-current"
          className="result-action-button"
          action="download-selected"
          disabled={!count || !!product?._summary}
        >
          下载本套选中图片
        </ActionButton>
      </div>
    </footer>
  );
}
