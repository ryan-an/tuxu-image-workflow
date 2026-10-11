import { chosen } from "../../model.js";
import { productPhotos } from "../../prompt-suite.js";
import { ActionButton, useApplication } from "../context.tsx";
import { currentProduct, productStats, selectedCount } from "../selectors";
import { TaskCard } from "./TaskCard.tsx";

export function Workbench() {
  const { state, ui } = useApplication(),
    product = currentProduct(state);
  if (!product)
    return <div className="empty-page">从表格解析产品，或添加第一个产品。</div>;
  const interruptedAnalysis = state.jobs.find(
      (j) =>
        j.productId === product.id &&
        j.kind === "prompt-set" &&
        j.status === "interrupted",
    ),
    activeAnalysis = state.jobs.find(
      (j) =>
        j.productId === product.id &&
        j.kind === "prompt-set" &&
        ["queued", "running"].includes(j.status),
    ),
    analysisBusy = state.jobs.some(
      (j) =>
        j.productId === product.id &&
        j.kind === "prompt-set" &&
        ["queued", "running"].includes(j.status),
    ),
    stats = productStats(product),
    tasks = product.tasks.filter(
      (t) =>
        ui.filter === "all" ||
        (ui.filter === "missing"
          ? !chosen(t)
          : ui.filter === "selected"
            ? !!chosen(t)
            : t.versions.length > 1),
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">PRODUCT WORKSPACE</span>
          <h1>{product.name}</h1>
          <p>
            {product.code} <span>·</span> {stats.done} 个位置已选结果，
            {stats.versions} 个历史版本
          </p>
        </div>
        <ActionButton action="edit-product">编辑产品</ActionButton>
      </div>
      <div className="product-info">
        <ActionButton className="product-photo" action="upload-photo">
          {product.photo ? (
            <img src={product.photo} alt="产品实拍" />
          ) : (
            "＋实拍"
          )}
        </ActionButton>
        <div>
          <strong>产品资料</strong>
          <p>{product.facts || "补充规格、材质、颜色等，帮助生成准确图片"}</p>
        </div>
        <ActionButton className="text-button" action="manage-photos">
          实拍图 {productPhotos(product).length} 张
        </ActionButton>
        <ActionButton className="text-button" action="common-prompt">
          整套共用要求
        </ActionButton>
        <ActionButton
          className="subtle-primary"
          action={interruptedAnalysis ? "reconcile-job" : "generate-prompt"}
          data={interruptedAnalysis ? { id: interruptedAnalysis.id } : {}}
          disabled={analysisBusy}
          title={
            analysisBusy ? "整套分析正在排队或执行，请等待结果" : undefined
          }
        >
          {interruptedAnalysis
            ? "分析中断，核对后重试"
            : "生成整套 10 张提示词"}
        </ActionButton>
        {activeAnalysis && (
          <ActionButton
            className="text-button queue-stop"
            action="cancel-job"
            data={{ id: activeAnalysis.id }}
          >
            {activeAnalysis.status === "running" ? "终止分析" : "取消分析"}
          </ActionButton>
        )}
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
          <div className="empty-page">当前筛选没有图片位置</div>
        )}
      </div>
    </>
  );
}
export function BatchBar() {
  const { state, ui } = useApplication(),
    count = selectedCount(currentProduct(state));
  return (
    <footer id="batch-bar" hidden={ui.view !== "workbench"}>
      <div id="batch-label">
        <strong>当前产品 · 已勾选 {count} 张下载图片</strong>
        <span>生成操作处理本套全部 10 个位置</span>
      </div>
      <div>
        <ActionButton action="batch-prompt">生成整套提示词</ActionButton>
        <ActionButton action="batch-images">生成本套 10 张图片</ActionButton>
        <ActionButton className="primary" action="batch-workflow">
          执行本套流程
        </ActionButton>
        <ActionButton
          id="download-current"
          action="download-selected"
          disabled={!count}
        >
          下载本套选中图片
        </ActionButton>
      </div>
    </footer>
  );
}
