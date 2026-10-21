import { useState } from "react";
import type { Product } from "../types";
import { ActionButton, ApplicationForm, useApplication } from "../context.tsx";
import { productRequirements } from "../../../shared/prompt-suite.js";
import { Badge } from "../design-system/Badge";

export function RequirementsDialog({ product }: { product: Product }) {
  const { state } = useApplication();
  const [initial] = useState(() => productRequirements(product, state.common));
  const [draft, setDraft] = useState(initial);
  const [beforeReset, setBeforeReset] = useState<string | null>(null);
  const changed = draft !== initial;
  const analyzing = state.jobs.some(
    (job) =>
      job.productId === product.id &&
      job.kind === "prompt-set" &&
      ["queued", "running"].includes(job.status),
  );
  return (
    <>
      <div className="requirements-dialog-heading">
        <span className="requirements-product">
          {product.code} · {product.name}
        </span>
        <h2 id="requirements-dialog-title">整套提示词生成要求</h2>
        <p>设定这套图的布局、文案、风格与产品规则，全文都可以修改。</p>
      </div>
      <div className="requirements-scope">
        <Badge tone="brand" className="requirements-badge">
          仅当前产品
        </Badge>
        <span>每个产品默认使用同一份要求，你可以在这里单独调整。</span>
      </div>
      <ApplicationForm id="common-form" data-product={product.id}>
        <div className="requirements-editor-heading">
          <label htmlFor="product-requirements">生成要求</label>
          <span>
            {draft === state.common ? "默认要求" : "本产品自定义要求"}
          </span>
        </div>
        <textarea
          id="product-requirements"
          name="common"
          rows={18}
          required
          maxLength={100000}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-describedby="requirements-effect"
          spellCheck={false}
        />
        <div className="requirements-editor-meta">
          <span aria-live="polite">
            {changed ? "有未保存修改" : "与当前保存内容一致"}
          </span>
          <span>{draft.length.toLocaleString()} 字</span>
        </div>
        <p id="requirements-effect" className="requirements-effect">
          {analyzing
            ? "当前分析任务继续使用启动时的要求；本次修改用于下一次生成提示词。"
            : "保存后，下次生成本产品提示词时生效。已有提示词和图片会保留。"}
        </p>
        <div className="requirements-dialog-actions">
          <div>
            <button
              type="button"
              className="requirements-reset"
              disabled={draft === state.common}
              onClick={() => {
                setBeforeReset(draft);
                setDraft(state.common);
              }}
            >
              恢复默认要求
            </button>
            {beforeReset !== null && (
              <button
                type="button"
                className="requirements-reset"
                onClick={() => {
                  setDraft(beforeReset);
                  setBeforeReset(null);
                }}
              >
                撤销恢复
              </button>
            )}
          </div>
          <div>
            <ActionButton action="close-modal">取消</ActionButton>
            <button
              type="submit"
              className="primary"
              disabled={!changed || !draft.trim()}
            >
              保存当前产品要求
            </button>
          </div>
        </div>
      </ApplicationForm>
    </>
  );
}
