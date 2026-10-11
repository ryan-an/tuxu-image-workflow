import { ActionButton, useApplication } from "../context.tsx";

// Univer owns the contents of this stable host. Switching views only hides it.
export function SheetPanel() {
  const { ui } = useApplication();
  return (
    <section id="sheet-section" hidden={ui.view !== "sheet"}>
      <div className="sheet-toolbar">
        <div>
          <strong>工作流表格</strong>
          <span>每个产品三行：示例图 → 提示词 → 结果图</span>
        </div>
        <ActionButton action="paste-links">粘贴参考图</ActionButton>
        <ActionButton className="subtle-primary" action="parse-sheet">
          解析到应用
        </ActionButton>
        <ActionButton id="export" action="export-excel" disabled={ui.exporting}>
          导出 Excel
        </ActionButton>
        <ActionButton action="backup">备份工作流</ActionButton>
        <ActionButton action="restore">恢复备份</ActionButton>
      </div>
      <div className="sheet-guide">
        外部表格粘贴到「外部粘贴」，再解析到应用。「工作流预览」自动接收提示词与已选结果；修改表格后可重新解析。
      </div>
      <div id="sheet-container" />
    </section>
  );
}
