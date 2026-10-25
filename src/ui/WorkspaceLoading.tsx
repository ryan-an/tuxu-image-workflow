import "./workspace-loading.css";

function PictureOutline() {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect x="5" y="5" width="30" height="30" rx="7" />
      <circle cx="14" cy="14" r="3" />
      <path d="m7 29 9-9 6 6 5-5 7 8" />
    </svg>
  );
}

function LoadingMark() {
  return (
    <div className="workspace-loading-mark" aria-hidden="true">
      <span className="workspace-loading-halo" />
      <span className="workspace-loading-frame is-back" />
      <span className="workspace-loading-frame is-middle" />
      <span className="workspace-loading-frame is-front">
        <PictureOutline />
        <i />
      </span>
      <span className="workspace-loading-spark is-first" />
      <span className="workspace-loading-spark is-second" />
    </div>
  );
}

export function WorkspaceLoading({
  title = "正在打开工作台",
  product,
}: {
  title?: string;
  product?: { name: string; code: string };
}) {
  if (product)
    return (
      <div className="workspace-loading-product" role="status" aria-busy="true">
        <div className="workspace-loading-product-heading">
          <div>
            <span className="workspace-loading-eyebrow">PRODUCT WORKSPACE</span>
            <h1>{product.name}</h1>
            <p>{product.code}</p>
          </div>
          <div className="workspace-loading-note">
            <span className="workspace-loading-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            正在加载产品图片和提示词…
          </div>
        </div>
        <div className="workspace-loading-summary" aria-hidden="true">
          <span className="workspace-loading-summary-icon">
            <PictureOutline />
          </span>
          <div className="workspace-skeleton-lines">
            <i />
            <i />
          </div>
          <span className="workspace-loading-summary-badge" />
        </div>
        <div className="workspace-loading-cards" aria-hidden="true">
          {[0, 1].map((index) => (
            <div
              className="workspace-skeleton-card workspace-shimmer"
              key={index}
            >
              <div className="workspace-skeleton-card-heading">
                <i />
                <span />
                <b />
              </div>
              <div className="workspace-skeleton-pictures">
                {[0, 1].map((picture) => (
                  <div key={picture}>
                    <span />
                    <div className="workspace-skeleton-picture">
                      <PictureOutline />
                    </div>
                  </div>
                ))}
              </div>
              <div className="workspace-skeleton-lines">
                <i />
                <i />
                <i />
              </div>
              <div className="workspace-skeleton-card-footer">
                <i />
                <span />
              </div>
            </div>
          ))}
        </div>
        <span className="workspace-loading-product-caption" aria-hidden="true">
          让每一份灵感，各就其位
        </span>
      </div>
    );
  return (
    <div className="workspace-loading-screen" role="status" aria-busy="true">
      <div className="workspace-loading-center">
        <div className="workspace-loading-brand">
          图序<span>批量生图工作台</span>
        </div>
        <LoadingMark />
        <h1>{title}</h1>
        <p>正在准备你的创作空间</p>
        <div className="workspace-loading-track" aria-hidden="true">
          <span />
        </div>
        <span className="workspace-loading-caption">美好的创作，即将展开</span>
      </div>
      <span className="workspace-loading-signature" aria-hidden="true">
        图序 · 让创意有序发生
      </span>
    </div>
  );
}
