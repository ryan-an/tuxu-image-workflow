import { ActionButton } from "../context.tsx";

export function SheetLoading({
  status,
}: {
  status: "idle" | "loading" | "ready" | "error";
}) {
  const failed = status === "error";
  return (
    <div className="sheet-loading" aria-hidden={status === "ready"}>
      <div className="sheet-loading-skeleton" aria-hidden="true">
        <div className="sheet-loading-tools">
          <i />
          <i />
          <i />
          <i />
        </div>
        <div className="sheet-loading-grid">
          {Array.from({ length: 32 }, (_, i) => (
            <span key={i}>
              <i />
            </span>
          ))}
        </div>
      </div>
      <div className="sheet-loading-message" role="status" aria-live="polite">
        <div className="sheet-loading-mark" aria-hidden="true">
          {Array.from({ length: 9 }, (_, i) => (
            <span key={i} style={{ animationDelay: `${i * 90}ms` }} />
          ))}
        </div>
        <strong>{failed ? "表格暂时未能加载" : "正在展开你的工作表"}</strong>
        <p>{failed ? "请检查网络后重试" : "产品、图片与灵感，即将就位"}</p>
        {failed && (
          <ActionButton action="view" data={{ view: "sheet" }}>
            重新加载
          </ActionButton>
        )}
        {!failed && (
          <div className="sheet-loading-track" aria-hidden="true">
            <span />
          </div>
        )}
      </div>
    </div>
  );
}
