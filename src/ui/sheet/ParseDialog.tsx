import type { ParserContext, ColumnField } from "../types";
import { ROLES } from "../../model.js";
import { ActionButton, useApplication } from "../context.tsx";

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
      value={value ?? -1}
      onChange={(e) =>
        controller.updateParser(field, roleIndex, Number(e.target.value))
      }
    >
      <option value={-1}>不使用</option>
      {Array.from({ length: Math.min(40, source.columnCount) }, (_, c) => (
        <option key={c} value={c}>
          {String.fromCharCode(65 + (c % 26))} ·{" "}
          {source.cellData?.[mapping.headerRow]?.[c]?.v || `列 ${c + 1}`}
        </option>
      ))}
    </select>
  );
}
export function ParseDialog({ context }: { context: ParserContext }) {
  const { controller } = useApplication(),
    { source, mapping, layout, candidates } = context;
  return (
    <>
      <h2>解析表格到应用</h2>
      <p className="modal-subtitle">
        来源：{source.name}。同编号产品更新参考图和提示词，历史结果保留。
      </p>
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
          ["photoColumn", "实拍图列"],
        ].map(([field, label]) => (
          <label key={field}>
            {label}
            <ColumnSelect context={context} field={field as ColumnField} />
          </label>
        ))}
      </div>
      <details>
        <summary>图片类型列对应关系</summary>
        <div className="form-grid">
          {ROLES.map((role, i) => (
            <label key={role}>
              {role}
              <ColumnSelect context={context} roleIndex={i} />
            </label>
          ))}
        </div>
      </details>
      <div className="parse-summary">
        识别到 <strong>{candidates.length}</strong> 个产品 ·{" "}
        {candidates.reduce(
          (n, p) => n + p.tasks.filter((t) => t.references.length).length,
          0,
        )}{" "}
        个参考图位置
      </div>
      <div className="parse-products">
        {candidates.map((p) => (
          <div key={p.code}>
            <strong>{p.code}</strong>
            <span>{p.name || "未填写名称"}</span>
            <small>
              {p.tasks.filter((t) => t.references.length).length} 图 ·{" "}
              {p.tasks.filter((t) => t.prompt).length} 提示词 ·{" "}
              {p.tasks.filter((t) => t.result).length} 结果
            </small>
          </div>
        ))}
        {!candidates.length && (
          <p>未识别到数据，调整列对应关系或先粘贴表格。</p>
        )}
      </div>
      <ActionButton
        className="primary"
        action="confirm-parse"
        disabled={!candidates.length}
      >
        确认解析到应用
      </ActionButton>
    </>
  );
}
