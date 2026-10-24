import { createElement } from "react";
const colors = ["#245edb", "#147a42", "#945b06", "#c92f46", "#5b4fe8"];
export function collaboratorColor(id) {
  return colors[
    [...id].reduce((hash, char) => hash + char.charCodeAt(0), 0) % colors.length
  ];
}
export function publishSheetSelection(bridge, event) {
  if (!bridge.workbook || document.hidden || !bridge.collaborationVisible)
    return bridge.onSelection?.(null);
  const sheet = event?.worksheet || bridge.workbook.getActiveSheet();
  const range = event?.selections?.[0] || sheet?.getActiveRange()?.getRange();
  if (!range) return bridge.onSelection?.(null);
  const sheetId = sheet.getSheetId();
  bridge.onSelection?.({
    sheetId,
    startRow: bridge.canonicalRow(range.startRow, sheetId),
    endRow: bridge.canonicalRow(range.endRow, sheetId),
    startColumn: range.startColumn,
    endColumn: range.endColumn,
  });
}
export function showSheetCollaborators(bridge, peers) {
  for (const item of bridge.peerDecorations || []) item?.dispose();
  bridge.peerDecorations = [];
  bridge.peers = peers;
  if (!bridge.workbook || !bridge.collaborationVisible) return;
  for (const peer of peers) {
    const sheet = bridge.workbook.getSheetBySheetId(peer.sheetId);
    if (!sheet) continue;
    const first =
      peer.sheetId === "preview" && bridge.pageRows
        ? bridge.pageRows.get(peer.startRow)
        : peer.startRow;
    const last =
      peer.sheetId === "preview" && bridge.pageRows
        ? bridge.pageRows.get(peer.endRow)
        : peer.endRow;
    if (first === undefined || last === undefined || last < first) continue;
    try {
      const range = sheet.getRange(
        first,
        peer.startColumn,
        last - first + 1,
        peer.endColumn - peer.startColumn + 1,
      );
      const color = collaboratorColor(peer.actor.id);
      bridge.peerDecorations.push(
        range.highlight({ stroke: color, strokeWidth: 2, fill: `${color}0a` }),
      );
      bridge.peerDecorations.push(
        range.attachRangePopup({
          componentKey: () =>
            createElement(
              "span",
              {
                className: "sheet-collaborator-label",
                style: { background: color },
                "data-peer-session": peer.session,
              },
              peer.actor.displayName,
            ),
          direction: "top",
          offset: [0, 0],
          showOnSelectionMoving: true,
        }),
      );
    } catch {
      /* A selection can outlive its sheet during a simultaneous page switch. */
    }
  }
}
export function applySheetSnapshot(bridge, previous) {
  if (
    !bridge.workbook ||
    !bridge.state.sheetSnapshot ||
    JSON.stringify(previous) === JSON.stringify(bridge.state.sheetSnapshot)
  )
    return;
  const active = bridge.workbook.getActiveSheet();
  const sheetId = active?.getSheetId();
  const selection = active?.getActiveRange()?.getRange();
  const local = bridge.workbook.save();
  const projected = bridge.project();
  const peers = bridge.peers || [];
  const structure = (snapshot) =>
    JSON.stringify({
      order: snapshot?.sheetOrder,
      sheets: Object.fromEntries(
        Object.entries(snapshot?.sheets || {}).map(([id, sheet]) => [
          id,
          {
            rowCount: sheet.rowCount,
            columnCount: sheet.columnCount,
            mergeData: sheet.mergeData || [],
            columnData: sheet.columnData || {},
            name: sheet.name,
          },
        ]),
      ),
    });
  bridge.receivingRemote = true;
  try {
    if (structure(previous) !== structure(bridge.state.sheetSnapshot)) {
      showSheetCollaborators(bridge, []);
      bridge.api.disposeUnit(bridge.workbook.getId());
      bridge.workbook = bridge.api.createWorkbook(projected);
      const sheet = bridge.workbook.getSheetBySheetId(sheetId);
      if (sheet && selection) sheet.getRange(selection).activate();
    } else {
      bridge.withSystemWrite(() =>
        bridge.workbook.addStyles(projected.styles || {}),
      );
      for (const [id, next] of Object.entries(projected.sheets)) {
        const old = local.sheets[id];
        const sheet = bridge.workbook.getSheetBySheetId(id);
        const cells = {};
        for (const row of new Set([
          ...Object.keys(old.cellData || {}),
          ...Object.keys(next.cellData || {}),
        ]))
          for (const column of new Set([
            ...Object.keys(old.cellData?.[row] || {}),
            ...Object.keys(next.cellData?.[row] || {}),
          ]))
            if (
              JSON.stringify(old.cellData?.[row]?.[column]) !==
              JSON.stringify(next.cellData?.[row]?.[column])
            ) {
              cells[row] ||= {};
              const cell = next.cellData?.[row]?.[column];
              cells[row][column] = cell
                ? {
                    ...cell,
                    v: cell.v ?? null,
                    p: cell.p ?? null,
                    f: cell.f ?? null,
                    s: cell.s ?? null,
                    t: cell.t ?? null,
                    custom: cell.custom ?? null,
                  }
                : null;
            }
        bridge.withSystemWrite(() => {
          if (Object.keys(cells).length)
            bridge.systemMutation(
              "sheet.mutation.set-range-values",
              { subUnitId: id, cellValue: cells },
              () => sheet.getRange(0, 0, 1, 1).setValues(cells),
            );
          const rows = {};
          for (const [row, data] of Object.entries(next.rowData || {})) {
            if (
              JSON.stringify(old.rowData?.[row]?.custom) !==
              JSON.stringify(data.custom)
            )
              rows[row] = { custom: data.custom || {} };
            if (old.rowData?.[row]?.h !== data.h && typeof data.h === "number")
              rows[row] = { ...rows[row], h: data.h, ia: 0 };
          }
          if (Object.keys(rows).length)
            bridge.systemMutation(
              "sheet.mutation.set-row-data",
              { subUnitId: id, rowData: rows },
              () =>
                sheet.setRowCustom(
                  Object.fromEntries(
                    Object.entries(rows).map(([row, data]) => [
                      row,
                      data.custom || {},
                    ]),
                  ),
                ),
            );
        });
      }
    }
  } finally {
    bridge.receivingRemote = false;
    showSheetCollaborators(bridge, peers);
    publishSheetSelection(bridge);
  }
}
