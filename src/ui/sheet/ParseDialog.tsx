import type { ParserContext, ColumnField } from "../types";
import { useState } from "react";
import { ROLES } from "../../../shared/model.js";
import { useApplication } from "../context.tsx";
import { DialogActions } from "../dialogs/DialogActions";
const COLUMN_LABELS = {
  codeColumn: "编号列",
  nameColumn: "名称 / 资料列",
  typeColumn: "行类型列",
  photoColumn: "实拍图起始列",
};

function columnLabel(column: number) {
  let label = "";
  for (let n = column + 1; n > 0; n = Math.floor((n - 1) / 26))
    label = String.fromCharCode(65 + ((n - 1) % 26)) + label;
  return label;
}

function ColumnSelect({
  context,
  field,
  roleIndex,
}: {
  context: ParserContext;
  field?: ColumnField;
  roleIndex?: number;
}) {
  const { controller } = useApplication(),
    { source, mapping } = context;
  const value = field ? mapping[field] : mapping.roles[roleIndex!];
  return (
    <select
      aria-label={field ? COLUMN_LABELS[field] : ROLES[roleIndex!]}
      value={value ?? -1}
      onChange={(e) =>
        controller.updateParser(field, roleIndex, Number(e.target.value))
      }
    >
      <option value={-1}>不使用</option>
      {Array.from({ length: Math.min(40, source.columnCount) }, (_, c) => (
        <option key={c} value={c}>
          {columnLabel(c)} ·{" "}
          {source.cellData?.[mapping.headerRow]?.[c]?.v || `列 ${c + 1}`}
        </option>
      ))}
    </select>
  );
}
export function ParseDialog({ context }: { context: ParserContext }) {
  const { controller } = useApplication(),
    { source, mapping, layout, candidates, changes } = context;
  const pendingProducts = context.importId ? candidates : changes;
  const [saving, setSaving] = useState(false);
  return (
    <>
      <h2>保存并解析表格</h2>
      <p className="modal-subtitle">
        来源：{source.name}。按产品编号匹配更新，历史结果保留。
      </p>
      {context.importId && (
        <p className="modal-subtitle">
          后端已解析全部 {context.total ?? candidates.length}{" "}
          个产品。确认后统一生成三行结构，按每页30个展示；新增 {context.created}{" "}
          个，更新 {context.updated} 个。
        </p>
      )}
      {!context.importId && (
        <details className="parse-advanced">
          <summary>高级配置</summary>
          <div className="form-grid">
            <label>
              数据布局
              <select
                id="parse-layout"
                value={layout}
                onChange={(e) =>
                  controller.updateParser("layout", null, e.target.value)
                }
              >
                <option value="auto">自动识别</option>
                <option value="three">每产品三行</option>
                <option value="single">每行一个产品</option>
              </select>
            </label>
            <label>
              表头所在行
              <input
                type="number"
                id="parse-header"
                min={0}
                value={mapping.headerRow + 1}
                title="0 表示没有表头"
                onChange={(e) =>
                  controller.updateParser(
                    "headerRow",
                    null,
                    Number(e.target.value) - 1,
                  )
                }
              />
            </label>
            {[
              ["codeColumn", "编号列"],
              ["nameColumn", "名称 / 资料列"],
              ["typeColumn", "行类型列"],
              ["photoColumn", "实拍图起始列"],
            ].map(([field, label]) => (
              <label key={field}>
                {label}
                <ColumnSelect context={context} field={field as ColumnField} />
              </label>
            ))}
          </div>
          <h4>图片类型列对应关系</h4>
          <div className="form-grid">
            {ROLES.map((role, i) => (
              <label key={role}>
                {role}
                <ColumnSelect context={context} roleIndex={i} />
              </label>
            ))}
          </div>
        </details>
      )}
      {!!context.issues?.length && (
        <div className="error-text" role="alert">
          {context.issues.map((issue) => (
            <p key={issue}>{issue}</p>
          ))}
        </div>
      )}
      <p className="modal-subtitle">
        自动收集实拍图各列，空位跳过、重复图片去重，按从左到右的顺序存入实拍图列表。
      </p>
      <div className="parse-summary">
        识别到{" "}
        <strong>
          {context.importId
            ? (context.total ?? candidates.length)
            : changes.length}
        </strong>{" "}
        个待保存产品 ·{" "}
        {context.referenceCount ??
          changes.reduce(
            (n, p) => n + p.tasks.filter((t) => t.references.length).length,
            0,
          )}{" "}
        个参考图位置
      </div>
      {context.importId && (context.total || 0) > candidates.length && (
        <p className="modal-subtitle">
          下方仅预览前{candidates.length}个产品，确认将导入全部{context.total}
          个，导入数量不受展示分页限制。
        </p>
      )}
      <div className="parse-products">
        {pendingProducts.map((p) => (
          <div key={p.code}>
            <strong>{p.code}</strong>
            <span>{p.name || "未填写名称"}</span>
            <small>
              待保存 · {p.photos.length} 张实拍图 ·{" "}
              {p.tasks.filter((t) => t.references.length).length} 图 ·{" "}
              {p.tasks.filter((t) => t.prompt).length} 提示词 ·{" "}
              {p.tasks.filter((t) => t.result).length} 结果
            </small>
          </div>
        ))}
        {!candidates.length && (
          <p>未识别到数据，调整列对应关系或先粘贴表格。</p>
        )}
        {!!candidates.length && !changes.length && (
          <p>所有产品均无变更，无需更新。</p>
        )}
      </div>
      <DialogActions>
        <button
          type="button"
          className="primary"
          data-action="confirm-parse"
          aria-busy={saving}
          disabled={
            saving || !pendingProducts.length || !!context.issues?.length
          }
          onClick={async () => {
            if (saving) return;
            setSaving(true);
            try {
              await controller.dispatch("confirm-parse");
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "保存中…" : "保存并解析"}
        </button>
      </DialogActions>
    </>
  );
}
