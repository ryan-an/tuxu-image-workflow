export function GenerationProgress({
  generation,
  overlay,
}: {
  generation: {
    phase: string;
    label: string;
    detail: string;
    progress: number | null;
  };
  overlay: boolean;
}) {
  const { progress, label, detail } = generation;
  return (
    <div
      className={`generation-progress ${overlay ? "is-overlay" : ""}`}
      aria-busy="true"
    >
      <div className="generation-art" aria-hidden="true">
        <span className="generation-art-glow" />
        <span className="generation-art-sheet is-back" />
        <span className="generation-art-sheet is-front">
          <svg viewBox="0 0 56 44" fill="none">
            <circle cx="38" cy="13" r="4" />
            <path d="M7 35 21 18l10 12 6-7 12 12" />
          </svg>
          <span className="generation-scan" />
        </span>
        <span className="generation-art-spark">✦</span>
        <span className="generation-art-dot" />
      </div>
      <strong>{label}</strong>
      <small className="generation-detail">
        {overlay ? `新版本 · ${detail}` : detail}
      </small>
      <div className="generation-meter">
        <div className="generation-meter-label">
          <span>{progress === null ? "准备中" : "生成进度"}</span>
          {progress !== null && (
            <span className="generation-percent">{progress}%</span>
          )}
        </div>
        <div
          className={`generation-track ${progress === null ? "is-indeterminate" : ""}`}
          role="progressbar"
          aria-label="图片生成进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress ?? undefined}
          aria-valuetext={progress === null ? label : `${label} ${progress}%`}
        >
          <i
            style={{ width: progress === null ? undefined : `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}
