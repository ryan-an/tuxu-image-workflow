import type { Product, ImageTask } from "../types";
import { productPhotos } from "../../prompt-suite.js";
import { ActionButton, useApplication } from "../context.tsx";

export function MediaDialog({
  product,
  task,
}: {
  product: Product;
  task?: ImageTask;
}) {
  const { ui } = useApplication(),
    sources = task ? task.references : productPhotos(product);
  return (
    <div id="media-uploader">
      <h2>{task ? `${task.role} · 参考图` : "产品实拍图"}</h2>
      <p className="modal-subtitle">
        {task
          ? "仅添加到当前图片位置，用于分析布局和文案。"
          : "添加当前产品的不同实拍视角，供整套分析和生图使用。"}
        默认追加图片，已有图片保留。
      </p>
      <div
        id="media-dropzone"
        className="media-dropzone"
        tabIndex={0}
        aria-label="图片拖拽与粘贴区域"
      >
        <span className="media-drop-icon">＋</span>
        <strong>拖拽图片到这里</strong>
        <span>
          或在此窗口按 <kbd>Ctrl</kbd> + <kbd>V</kbd> 粘贴图片
        </span>
        <small>支持截图、复制的图片、石墨图片单元格，可连续添加</small>
      </div>
      <div className="media-upload-actions">
        <ActionButton className="primary" action="choose-image-files">
          选择图片文件
        </ActionButton>
        <ActionButton action="paste-media">读取剪贴板</ActionButton>
        {!!sources.length && (
          <ActionButton
            className="text-button"
            action="choose-image-files"
            data={{ replace: "true" }}
          >
            替换全部…
          </ActionButton>
        )}
      </div>
      <p
        id="media-feedback"
        className={`media-feedback ${ui.mediaError ? "error-text" : ""}`}
        role="status"
        aria-live="polite"
      >
        {ui.mediaFeedback || "添加后自动保存，重复图片会跳过。"}
      </p>
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
            >
              移除
            </ActionButton>
          </div>
        ))}
        {!sources.length && (
          <p className="empty-small">还没有图片，粘贴或拖入第一张吧。</p>
        )}
      </div>
      <div className="media-modal-footer">
        <small>添加图片不会启动生成任务</small>
        <ActionButton action="close-modal">完成</ActionButton>
      </div>
    </div>
  );
}
