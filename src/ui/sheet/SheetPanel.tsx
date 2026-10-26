import { SheetPagination } from "./SheetPagination.tsx";
import { SheetLoading } from "./SheetLoading.tsx";
import { ActionButton, useApplication } from "../context.tsx";
import { ReadOnlySheet } from "./ReadOnlySheet";
import { collaboratorColor } from "../../integrations/sheet-collaboration.js";

// Univer owns the contents of this stable host. Switching views only hides it.
export function SheetPanel() {
  const { ui, controller, user } = useApplication();
  const ready = user.role === "viewer" || ui.sheetStatus === "ready";
  return (
    <section id="sheet-section" hidden={ui.view !== "sheet"}>
      <div className="sheet-toolbar">
        <div className="sheet-heading">
          <h2>产品工作表</h2>
          <div className="sheet-help">
            <button
              type="button"
              className="sheet-help-button"
              aria-label="表格使用帮助"
              aria-describedby="sheet-help-tooltip"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="9" />
                <path
                  d="M9.5 9a2.5 2.5 0 0 1 5 .5c0 1.5-2.5 2-2.5 3.5"
                  strokeLinecap="round"
                />
                <circle
                  cx="12"
                  cy="16.5"
                  r=".8"
                  fill="currentColor"
                  stroke="none"
                />
              </svg>
            </button>
            <div
              id="sheet-help-tooltip"
              className="sheet-help-tooltip"
              role="tooltip"
            >
              <p>
                导入或粘贴时每个产品一行，解析后自动补成示例图、提示词、结果图三行。
              </p>
              <p>修改表格后显示未同步，点击「保存并解析」才更新产品工作区。</p>
              <p>仅实际修改过的单元格受保护，其余位置自动回填。</p>
              <p>默认行高：示例图 160、提示词 120、结果图 160；可手动调整。</p>
              <p>将外部表格粘贴到「外部粘贴」，再点击「保存并解析」。</p>
              <p>
                「工作流预览」自动接收提示词与已选结果；修改表格后可重新解析。
              </p>
            </div>
          </div>
          <span className="sheet-live-label">
            <span className="sheet-live-dot" aria-hidden="true" />
            全部工作实时更新
          </span>
        </div>
        <div className="sheet-toolbar-pagination">
          <SheetPagination />
          {!!ui.sheetPeers.length && (
            <div className="sheet-online-users" aria-label="在线协作者">
              {ui.sheetPeers.map((peer) => (
                <span
                  className="sheet-online-user"
                  key={peer.session}
                  title={`${peer.actor.displayName} · ${peer.sheetId} · 第 ${peer.startRow + 1} 行，第 ${peer.startColumn + 1} 列`}
                >
                  <i style={{ background: collaboratorColor(peer.actor.id) }} />
                  {peer.actor.displayName}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="sheet-toolbar-actions">
          <ActionButton action="import-sheet" disabled={ui.importing || !ready}>
            {ui.importing ? "正在上传解析…" : "导入解析"}
          </ActionButton>
          <ActionButton action="delete-sheet-rows" disabled={!ready}>
            删除选中行
          </ActionButton>
          <ActionButton
            className="primary sheet-parse-button"
            action="parse-sheet"
            disabled={!ready}
          >
            保存并解析
          </ActionButton>
          <ActionButton
            id="export"
            action="export-excel"
            disabled={ui.exporting || !ready}
          >
            导出 Excel
          </ActionButton>
          <ActionButton action="export-template" disabled={ui.exporting}>
            导出模板
          </ActionButton>
        </div>
      </div>
      <input
        id="sheet-import-input"
        type="file"
        accept=".xlsx"
        hidden
        onChange={controller.importSheetFile}
      />
      {!!ui.sheetConflicts.length && (
        <details className="sheet-conflicts" open>
          <summary>
            有 {ui.sheetConflicts.length} 处回填冲突，已保留你的修改
          </summary>
          <ul>
            {ui.sheetConflicts.map((conflict) => (
              <li key={conflict.key}>
                <span>{conflict.message}</span>
                <div>
                  <button
                    type="button"
                    onClick={() =>
                      controller.resolveSheetConflict(conflict.key, "local")
                    }
                  >
                    保留表格修改
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      controller.resolveSheetConflict(conflict.key, "remote")
                    }
                  >
                    采用生成内容
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
      {user.role === "viewer" ? (
        ui.view === "sheet" && <ReadOnlySheet />
      ) : (
        <div
          className="sheet-viewport"
          data-state={ui.sheetStatus}
          aria-busy={ui.sheetStatus === "loading"}
        >
          <div id="sheet-container" inert={!ready} />
          <SheetLoading status={ui.sheetStatus} />
        </div>
      )}
    </section>
  );
}
