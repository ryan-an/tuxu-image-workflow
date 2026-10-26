import { applySheetImport } from "../../shared/sheet-import.js";
import { api } from "../services/workspace-client.js";
import { productPhotos } from "../../shared/prompt-suite.js";
import { chosen } from "../../shared/model.js";
import { PRODUCT_PAGE_SIZE } from "../view-models/product-page.js";

import {
  detectColumns,
  parseSheet,
  validateSheetParse,
  imageCell,
} from "../../shared/sheet-data.js";

// Match the import rules: missing external columns preserve existing values,
// while explicitly empty preview cells can clear them.
export function parsedProductNeedsUpdate(source, product, authoritative) {
  if (!product) return true;
  const name =
    authoritative && source.present.metadata
      ? source.name
      : source.name || product.name;
  const facts =
    authoritative && source.present.metadata
      ? source.facts
      : source.facts || product.facts;
  if (name !== product.name || facts !== product.facts) return true;
  if (
    ((authoritative && source.present.photo) || source.photos.length) &&
    JSON.stringify(source.photos) !== JSON.stringify(productPhotos(product))
  )
    return true;
  return source.tasks.some((item) => {
    const task = product.tasks.find((task) => task.role === item.role);
    if (!task) return true;
    if (
      ((authoritative && item.present.references) || item.references.length) &&
      (item.references[0] !== task.references[0] ||
        (!item.references.length && task.references.length) ||
        (item.references.length > 1 &&
          JSON.stringify(item.references) !== JSON.stringify(task.references)))
    )
      return true;
    if (
      ((authoritative && item.present.prompt) || item.prompt) &&
      item.prompt !== task.prompt
    )
      return true;
    return item.result
      ? item.result !== (chosen(task)?.source || "")
      : authoritative &&
          item.present.result &&
          (task.primaryId !== null || task.selectedIds.length > 0);
  });
}

export function createSheet(context) {
  let parseContext = null;
  let opening = false,
    parsing = false;
  let mounting = null;
  async function syncTask(p, t, kind, force = false) {
    const { bridge, notify } = context;
    try {
      await context.ensureSheet?.();
      await bridge.sync(p, t, kind, force);
    } catch (error) {
      notify(`结果已保留，表格回填失败：${error.message}`);
      throw error;
    }
  }

  async function updateMetadata(
    product,
    oldCode = product.code,
    force = false,
  ) {
    await context.ensureSheet?.();
    const { state, bridge } = context;
    const snap = bridge.snapshot(),
      sheet = snap.sheets.preview,
      mapping = detectColumns(sheet);
    for (const [r, cells] of Object.entries(sheet.cellData)) {
      if (
        String(cells[mapping.codeColumn]?.v) !== oldCode &&
        !(
          sheet.rowData?.[r]?.custom?.workflowProductId === product.id &&
          cells[mapping.typeColumn]?.v === "示例图"
        )
      )
        continue;
      const writes = [
        [mapping.codeColumn, { ...cells[mapping.codeColumn], v: product.code }],
        [
          mapping.nameColumn,
          {
            ...cells[mapping.nameColumn],
            v: `${product.name}\n${product.facts}`,
            p: null,
          },
        ],
      ];
      if (cells[mapping.typeColumn]?.v === "示例图")
        (mapping.photoColumns || [mapping.photoColumn]).forEach((column, i) => {
          if (column >= 0)
            writes.push([column, imageCell(productPhotos(product)[i])]);
        });
      for (const [column, cell] of writes)
        if (column >= 0) {
          bridge.writeSyncedCell(
            Number(r),
            column,
            cell,
            force,
            `${product.code} · 产品资料`,
          );
        }
    }
    state.sheetSnapshot = snap;
    bridge.batchLocations = null;
    bridge.capture();
  }

  async function switchView(next) {
    const { bridge, render, setView } = context;
    if (next === "sheet" && context.canEdit !== false && !bridge.workbook)
      context.setSheetStatus("loading");
    setView(next);
    bridge.collaborationVisible = next === "sheet";
    bridge.showCollaborators(bridge.peers || []);
    bridge.publishSelection();
    if (typeof window !== "undefined" && window.location?.pathname === "/") {
      const url = new URL(window.location.href);
      if (next === "workspaces") url.searchParams.set("manage", "1");
      else url.searchParams.delete("manage");
      window.history.replaceState(
        null,
        "",
        url.pathname + url.search + url.hash,
      );
    }
    render();
    if (next !== "sheet") {
      bridge.capture();
      return;
    }
    const reconcile = async () => {
      await context.ensureAll?.();
      const errors = await bridge.reconcile();
      if (errors.length)
        context.notify("结果已保留，表格回填失败：" + errors[0]);
      render();
    };
    if (context.canEdit === false) {
      await reconcile();
      return;
    }
    if (!mounting && !bridge.workbook) {
      mounting = (async () => {
        try {
          // Let the loading surface paint before loading the spreadsheet engine.
          await new Promise((resolve) => requestAnimationFrame(resolve));
          await reconcile();
          await bridge.mount();
          // Reveal only after the mounted canvas has had a chance to render.
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          if (!bridge.disposed) context.setSheetStatus("ready");
        } catch (error) {
          context.setSheetStatus("error");
          throw error;
        } finally {
          mounting = null;
        }
      })();
    }
    if (mounting) await mounting;
    else {
      await reconcile();
      context.setSheetStatus("ready");
    }
    context.saveSoon();
  }

  async function openParser(importedSource = null) {
    const { bridge, renderParser } = context;
    if ((!bridge.workbook && !importedSource) || opening) return;
    opening = true;
    try {
      bridge.capture();
      await context.persist();
      const source = importedSource || bridge.parserSource();
      parseContext = {
        source,
        mapping: detectColumns(source),
        layout: "auto",
        candidates: [],
      };
      renderParser();
    } finally {
      opening = false;
    }
  }

  async function importSheetFile(event) {
    const input = event.target,
      file = input.files?.[0];
    if (!file || context.ui.importing) return;
    context.setImporting(true);
    try {
      await context.persist();
      const { importSheetFile } = await import(
        "../integrations/import-sheet.js"
      );
      parseContext = await importSheetFile(file);
      renderParser();
    } finally {
      input.value = "";
      context.setImporting(false);
    }
  }

  function renderParser() {
    const { ui, publish, showModal } = context;
    if (!parseContext.importId) {
      parseContext.candidates = parseSheet(
        parseContext.source,
        parseContext.mapping,
        parseContext.layout,
      );
      parseContext.issues = validateSheetParse(
        parseContext.source,
        parseContext.mapping,
        parseContext.layout,
        parseContext.candidates,
      );
    }
    const products = new Map(context.state.products.map((p) => [p.code, p]));
    parseContext.changes = parseContext.importId
      ? parseContext.candidates
      : parseContext.candidates.filter((source) =>
          parsedProductNeedsUpdate(
            source,
            products.get(source.code),
            parseContext.source.id === "preview",
          ),
        );
    ui.parser = {
      ...parseContext,
      mapping: {
        ...parseContext.mapping,
        roles: [...parseContext.mapping.roles],
      },
    };
    if (ui.modal?.type !== "parser") showModal({ type: "parser" });
    else publish();
  }

  async function confirmParse() {
    if (parsing) return;
    if (parseContext?.importId) {
      parsing = true;
      try {
        await context.persist();
        const result = await api(
          `/api/workspace/sheet-import/${parseContext.importId}/confirm`,
          { commandId: parseContext.commandId },
        );
        await context.bridge.withRemoteWorkspace(() =>
          context.repository.reload({ acceptRemoteSheet: true }),
        );
        context.state.activeProductId = result.firstProductId;
        context.ui.search = "";
        context.ui.filter = "all";
        const index = [...context.state.products]
          .sort((a, b) => a.code.localeCompare(b.code))
          .findIndex((p) => p.id === result.firstProductId);
        context.ui.productPage = Math.floor(Math.max(0, index) / 30) + 1;
        context.render();
        context.closeModal();
        await context.switchView("sheet");
        context.notify(
          `已导入并解析 ${result.total} 个产品：新增 ${result.created} 个，更新 ${result.updated} 个，按每页30个展示`,
        );
      } finally {
        parsing = false;
      }
      return;
    }
    if (!parseContext?.candidates.length) throw new Error("没有可解析的产品。");
    const issues = validateSheetParse(
      parseContext.source,
      parseContext.mapping,
      parseContext.layout,
      parseContext.candidates,
    );
    if (issues.length) throw new Error(issues.join("\n"));
    parsing = true;
    let originalRowData;
    try {
      const { state, bridge, change, closeModal, switchView, notify } = context;
      bridge.capture();
      const previousRows = structuredClone(
        state.sheetSnapshot.sheets.preview.rowData || {},
      );
      const imported = applySheetImport(state, parseContext.candidates, {
        authoritative: parseContext.source.id === "preview",
      });
      originalRowData = Object.fromEntries(
        Object.entries(previousRows).map(([row, value]) => [
          imported.rowMap.get(Number(row)) ?? row,
          value,
        ]),
      );
      const previousProducts = new Map(state.products.map((p) => [p.id, p]));
      state.products = imported.state.products.map((next) => {
        const previous = previousProducts.get(next.id);
        if (!previous) return next;
        const tasks = next.tasks.map((task) => {
          const old = previous.tasks.find((t) => t.id === task.id);
          return old ? Object.assign(old, task) : task;
        });
        return Object.assign(previous, next, { tasks });
      });
      const changedIds = new Set(imported.updatedIds);
      const selectedId =
        imported.importedIds.findLast(
          (id) => !previousProducts.has(id) || changedIds.has(id),
        ) || imported.importedIds.at(-1);
      state.activeProductId = selectedId;
      for (const id of imported.importedIds) bridge.knownProducts.add(id);
      bridge.replaceSnapshot(imported.state.sheetSnapshot, imported.rowMap);
      for (const [key, conflict] of bridge.conflicts)
        if (
          imported.importedIds.includes(
            state.sheetSnapshot.sheets.preview.rowData?.[conflict.row]?.custom
              ?.workflowProductId,
          )
        )
          bridge.removeConflict(key);
      change();
      await context.persist();
      // Persistence may reorder products. Reveal the saved product on its final
      // page, including when a search would otherwise hide the new product.
      if (selectedId) {
        context.ui.search = "";
        context.ui.productPage =
          Math.floor(
            state.products.findIndex((p) => p.id === selectedId) /
              PRODUCT_PAGE_SIZE,
          ) + 1;
      }
      closeModal();
      await switchView("workbench");
      notify(
        `已保存并解析：新增 ${imported.created} 个，更新 ${imported.updated} 个产品`,
      );
    } catch (error) {
      if (!originalRowData) throw error;
      const snapshot = context.bridge.snapshot();
      const preview = snapshot.sheets.preview;
      const codes = new Set(
        parseContext.candidates.map((product) => product.code),
      );
      const localRows = new Set();
      for (const product of parseSheet(preview, detectColumns(preview))) {
        if (!codes.has(product.code)) continue;
        for (const sourceRow of product.sourceRows) {
          const row = sourceRow - 1;
          preview.rowData[row] ||= {};
          preview.rowData[row].custom = {
            ...preview.rowData[row].custom,
            workflowDrafts: originalRowData[row]?.custom?.workflowDrafts || {},
            workflowDirty:
              Object.keys(originalRowData[row]?.custom?.workflowDrafts || {})
                .length > 0,
            workflowSaveFailed: true,
          };
          const local = context.bridge.pageRows
            ? context.bridge.pageRows.get(row)
            : row;
          if (local !== undefined) localRows.add(local);
        }
      }
      if (context.bridge.workbook) context.bridge.markDirtyRows(localRows);
      context.bridge.capture();
      throw error;
    } finally {
      parsing = false;
    }
  }

  function updateParser(field, roleIndex, value) {
    const { renderParser } = context;
    if (roleIndex != null) parseContext.mapping.roles[roleIndex] = value;
    else if (field === "layout") parseContext.layout = value;
    else {
      parseContext.mapping[field] = value;
      if (field === "photoColumn")
        parseContext.mapping.photoColumns =
          Number(value) < 0
            ? []
            : [
                Number(value),
                ...(
                  detectColumns(parseContext.source).photoColumns || []
                ).filter((column) => column > Number(value)),
              ];
    }
    renderParser();
  }

  return {
    syncTask,
    updateMetadata,
    switchView,
    openParser,
    importSheetFile,
    renderParser,
    confirmParse,
    updateParser,
    resolveSheetConflict: (key, prefer) =>
      context.bridge.resolveConflict(key, prefer),
  };
}
