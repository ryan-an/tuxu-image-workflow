import type { Product, ImageTask, ImageVersion } from "../types";
import { ActionButton, ApplicationForm, useApplication } from "../context.tsx";
import { formatTime } from "../selectors";
import { VersionSelection } from "../workbench/TaskCard.tsx";
import { DialogActions } from "./DialogActions";

export function PromptHistory({ task }: { task: ImageTask }) {
  return (
    <div className="prompt-history">
      {[...task.promptHistory].reverse().map((version, index) => (
        <article key={version.id || `${version.createdAt}-${index}`}>
          <small>{formatTime(version.createdAt)}</small>
          <p>{version.prompt}</p>
          <ActionButton
            action="restore-prompt"
            data={{
              task: task.id,
              index: task.promptHistory.length - index - 1,
            }}
          >
            使用这个提示词
          </ActionButton>
        </article>
      ))}
      {!task.promptHistory.length && (
        <p className="empty-small">暂无历史提示词</p>
      )}
    </div>
  );
}
export function PromptDialog({
  product,
  task,
}: {
  product: Product;
  task: ImageTask;
}) {
  return (
    <>
      <h2>{task.role} · 提示词</h2>
      <p className="modal-subtitle">编辑这张图的提示词，保存后重新生成图片。</p>
      <ApplicationForm
        id="prompt-form"
        data-product={product.id}
        data-task={task.id}
      >
        <label htmlFor={`prompt-${task.id}`}>
          作图提示词
          <textarea
            autoFocus
            id={`prompt-${task.id}`}
            name="prompt"
            rows={13}
            defaultValue={task.prompt}
            placeholder="先生成整套提示词，或在这里填写…"
          />
        </label>
        <details className="prompt-editor-history">
          <summary>
            历史提示词 <b>{task.promptHistory.length}</b>
          </summary>
          <PromptHistory task={task} />
        </details>
        <DialogActions>
          <span className="dialog-actions-note">
            已有图片使用的提示词保留在图片详情中
          </span>
          <ActionButton action="close-modal">取消</ActionButton>
          <button type="submit" className="primary">
            保存并重新生成
          </button>
        </DialogActions>
      </ApplicationForm>
    </>
  );
}
export function ProductDialog({
  product,
  isNew,
}: {
  product?: Product;
  isNew?: boolean;
}) {
  const { user } = useApplication();
  if (user.role === "viewer")
    return (
      <>
        <h2>产品资料</h2>
        <h3>
          {product?.code} · {product?.name}
        </h3>
        <p className="preserve-lines">{product?.facts || "暂无产品资料"}</p>
      </>
    );
  return (
    <>
      <h2>{isNew ? "添加产品" : "编辑产品"}</h2>
      <ApplicationForm
        id="product-form"
        data-new={isNew}
        data-product={product?.id}
      >
        <label>
          产品编号
          <input
            autoFocus
            name="code"
            required
            defaultValue={product?.code || ""}
            placeholder="例如 26-1732"
          />
        </label>
        <label>
          产品名称
          <input name="name" required defaultValue={product?.name || ""} />
        </label>
        <label>
          产品资料
          <textarea
            name="facts"
            rows={4}
            defaultValue={product?.facts || ""}
            placeholder="规格、材质、颜色、数量…"
          />
        </label>
        <DialogActions>
          <button className="primary" type="submit">
            保存产品
          </button>
        </DialogActions>
      </ApplicationForm>
    </>
  );
}
export function VersionDialog({
  task,
  version,
}: {
  task: ImageTask;
  version: ImageVersion;
}) {
  return (
    <div className="version-modal">
      <div>
        <span className="eyebrow">
          {task.role} · V{version.number}
        </span>
        <h2>历史生成图</h2>
        <p>
          {formatTime(version.createdAt)} ·{" "}
          {version.origin === "demo" ? "演示图片" : "生成结果"}
        </p>
      </div>
      <img className="large-preview" src={version.source} alt="历史效果图" />
      <details>
        <summary>生成时使用的提示词</summary>
        <p className="preserve-lines">{version.prompt}</p>
      </details>
      <DialogActions>
        <label className="dialog-actions-note">
          <VersionSelection task={task} version={version} /> 加入本套下载
        </label>
        <ActionButton
          action="download-version"
          data={{ task: task.id, version: version.id }}
        >
          下载这张
        </ActionButton>
        <ActionButton action="modal-primary" className="primary">
          {task.primaryId === version.id
            ? "当前表格展示版本"
            : "选为表格展示版本"}
        </ActionButton>
      </DialogActions>
    </div>
  );
}
export function ReconcileDialog({ id }: { id?: string }) {
  return (
    <>
      <h2>核对平台任务</h2>
      <p>
        先到平台确认受理情况。填写原任务 ID
        会继续查询；只有确认平台未受理后，才允许重新提交。
      </p>
      <ApplicationForm id="reconcile-form" data-id={id}>
        <label>
          平台任务 ID
          <input name="remoteId" />
        </label>
        <label>
          <input type="checkbox" name="confirmNotAccepted" />
          我已核对，平台没有受理原请求
        </label>
        <DialogActions>
          <button type="submit" className="primary">
            保存核对结果
          </button>
        </DialogActions>
      </ApplicationForm>
    </>
  );
}
export function PasteDialog() {
  return (
    <>
      <h2>粘贴参考图</h2>
      <p className="modal-subtitle">
        先在表格选中起始位置，然后粘贴石墨内容或图片链接表格。
      </p>
      <textarea
        autoFocus
        id="paste-content"
        rows={7}
        placeholder="Ctrl+V 粘贴…"
      />
      <DialogActions>
        <ActionButton className="primary" action="paste-insert">
          插入图片到表格
        </ActionButton>
      </DialogActions>
    </>
  );
}
