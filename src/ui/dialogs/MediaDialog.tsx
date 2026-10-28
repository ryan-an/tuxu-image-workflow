import { can } from "../../../shared/access";
import type { Product, ImageTask } from "../types";
import { productPhotos } from "../../../shared/prompt-suite.js";
import { ActionButton, useApplication } from "../context.tsx";

export function MediaDialog({
  product,
  task,
}: {
  product: Product;
  task?: ImageTask;
}) {
  const { ui, user } = useApplication(),
    sources = task ? task.references : productPhotos(product);
  return (
    <div id="media-uploader">
      <h2>{task ? `${task.role} · 参考图` : "产品实拍图"}</h2>
      {can(user, "edit") && (
        <p className="modal-subtitle">
          {task
            ? "仅添加到当前图片位置，用于分析布局和文案。"
            : "添加当前产品的不同实拍视角，供整套分析和生图使用。"}
          默认追加图片，已有图片保留。
        </p>
      )}
      <ActionButton
        id="media-dropzone"
        className="media-dropzone"
        action="choose-image-files"
        aria-label="选择图片，可多选，也可拖拽或粘贴"
        aria-describedby="media-upload-hint media-feedback"
      >
        <span className="media-drop-icon" aria-hidden="true">
          ＋
        </span>
        <span className="media-drop-copy">
          <strong>点击选择图片，或拖拽到这里</strong>
          <span>
            也可按 <kbd>Ctrl</kbd> + <kbd>V</kbd> 粘贴图片
          </span>
          <small id="media-upload-hint">
            支持截图、复制的图片、石墨图片单元格，可连续添加
          </small>
        </span>
      </ActionButton>
      {can(user, "edit") && (
        <p
          id="media-feedback"
          className={`media-feedback ${ui.mediaError ? "error-text" : ""}`}
          role="status"
          aria-live="polite"
        >
          {ui.mediaFeedback || "添加后自动保存，重复图片会跳过。"}
        </p>
      )}
      <div className="media-gallery-heading">
        已添加 <b>{sources.length}</b> 张
        {!task && !!sources.length && " · 第一张用于产品列表缩略图"}
      </div>
      <div className="reference-list media-gallery">
        {sources.map((source, index) => (
          <div key={`${source}-${index}`}>
            <img
              src={source}
              alt={`${task ? "参考" : "实拍"}图 ${index + 1}`}
              loading="lazy"
              decoding="async"
            />
            <span>
              {task ? "参考图" : "实拍图"} {index + 1}
            </span>
            <ActionButton
              action={task ? "remove-reference" : "remove-photo"}
              data={{ task: task?.id, index }}
              variant="secondary"
              size="sm"
            >
              移除
            </ActionButton>
          </div>
        ))}
        {!sources.length && (
          <p className="empty-small">
            {!can(user, "edit")
              ? "暂无图片"
              : "还没有图片，点击上方区域、粘贴或拖入第一张吧。"}
          </p>
        )}
      </div>
      <div className="media-modal-footer">
        <small>
          {!can(user, "edit") ? "只读查看" : "添加图片不会启动生成任务"}
        </small>
        <ActionButton action="close-modal" variant="secondary" size="sm">
          完成
        </ActionButton>
      </div>
    </div>
  );
}
