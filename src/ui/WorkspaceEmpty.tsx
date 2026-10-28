import { can } from "../../shared/access";
import { ActionButton, useApplication } from "./context";
import "./workspace-empty.css";

export function EmptyCollectionIcon() {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 7V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2M5 12V9a2 2 0 0 1 2-2h18a2 2 0 0 1 2 2v3" />
      <rect x="3" y="12" width="26" height="17" rx="4" />
      <path d="M12 20h8m-4-4v8" />
    </svg>
  );
}

function EmptyWorkspaceArt() {
  return (
    <div className="workspace-empty-art" aria-hidden="true">
      <div className="workspace-empty-art-glow" />
      <span className="workspace-empty-orbit" />
      <span className="workspace-empty-spark is-left">＋</span>
      <span className="workspace-empty-spark is-right">✦</span>
      <div className="workspace-empty-art-card is-back" />
      <div className="workspace-empty-art-card is-side">
        <i />
        <i />
        <i />
      </div>
      <div className="workspace-empty-art-card is-front">
        <span className="workspace-empty-art-photo">
          <svg viewBox="0 0 64 52" fill="none">
            <circle cx="21" cy="17" r="5" />
            <path d="m7 42 16-16 12 12 9-9 13 13" />
          </svg>
          <span className="workspace-empty-art-add">＋</span>
        </span>
        <i />
        <i />
      </div>
      <span className="workspace-empty-art-label">
        <span />
        新的创作，即将开始
      </span>
    </div>
  );
}

const steps = [
  { title: "添加产品资料", text: "填写产品信息，上传实拍与参考图" },
  { title: "生成整套图片", text: "编写提示词，按需生成不同场景" },
  { title: "选图与导出", text: "比较历史版本，保存满意的作品" },
];

export function WorkspaceEmpty({ queue = false }: { queue?: boolean }) {
  const { user } = useApplication();
  const canEdit = can(user, "edit");
  return (
    <section
      className="workspace-empty"
      aria-labelledby={queue ? "empty-queue-title" : "empty-workbench-title"}
    >
      <div className="workspace-empty-hero">
        <EmptyWorkspaceArt />
        <span className="workspace-empty-eyebrow">
          {canEdit ? "为下一份好作品，留一个位置" : "你的团队创作空间"}
        </span>
        <h1 id={queue ? "empty-queue-title" : "empty-workbench-title"}>
          {canEdit
            ? queue
              ? "第一套创作，从一个产品开始"
              : "把第一个产品，带进工作台"
            : "这里即将呈现新的作品"}
        </h1>
        <p className="workspace-empty-description">
          {canEdit ? (
            <>
              添加产品资料与实拍图，或从表格导入已有产品。
              <br />
              从灵感到成图，在这里有序展开。
            </>
          ) : (
            <>
              当前工作区还没有产品。
              <br />
              成员添加产品后，你可以在这里查看图片、比较版本并下载作品。
            </>
          )}
        </p>
        {canEdit ? (
          <div className="workspace-empty-actions">
            <ActionButton action="new-product" variant="primary">
              <svg
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M10 4v12M4 10h12" />
              </svg>
              添加第一个产品
            </ActionButton>
            <ActionButton
              action="view"
              data={{ view: "sheet" }}
              variant="secondary"
            >
              <svg
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="3" width="14" height="14" rx="3" />
                <path d="M3 8h14M8 8v9M3 12.5h14" />
              </svg>
              从表格导入
            </ActionButton>
          </div>
        ) : (
          <span className="workspace-empty-viewer-note">
            只读访问 · 等待成员添加产品
          </span>
        )}
      </div>
      {canEdit && (
        <ol className="workspace-empty-steps" aria-label="开始创作的三个步骤">
          {steps.map((step, index) => (
            <li key={step.title}>
              <span className="workspace-empty-step-number">0{index + 1}</span>
              <div>
                <strong>{step.title}</strong>
                <p>{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="workspace-empty-footnote">
        {canEdit
          ? "产品资料与创作记录，会自动保存在当前工作区"
          : "团队共享作品，创作记录有序保留"}
      </p>
    </section>
  );
}
