import { productPhotos } from "../../shared/prompt-suite.js";
import {
  newProduct,
  setPrimary,
  savePrompt,
  addVersion,
} from "../../shared/model.js";

import {
  detectColumns,
  parseSheet,
  validateSheetParse,
  imageCell,
} from "../integrations/sheet-bridge.js";

export function createSheet(context) {
  let parseContext = null;
  let opening = false,
    parsing = false;
  async function syncTask(p, t, kind, force = false) {
    const { bridge, notify } = context;
    try {
      await bridge.sync(p, t, kind, force);
    } catch (error) {
      notify(`结果已保留，表格回填失败：${error.message}`);
      throw error;
    }
  }

  function updateMetadata(product, oldCode = product.code, force = false) {
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
    setView(next);
    render();
    if (next === "sheet") await bridge.mount();
    else bridge.capture();
  }

  async function openParser() {
    const { bridge, renderParser } = context;
    if (!bridge.workbook || opening) return;
    opening = true;
    try {
      bridge.capture();
      await context.persist();
      const source = bridge.parserSource();
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

  function renderParser() {
    const { ui, publish, showModal } = context;
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
      context.bridge.completeProductRows(
        parseContext.candidates.map((product) => product.code),
      );
      originalRowData = structuredClone(
        context.bridge.snapshot().sheets.preview.rowData || {},
      );
      const {
        state,
        bridge,
        notify,
        change,
        closeModal,
        syncTask,
        updateMetadata,
        switchView,
      } = context;
      let created = 0,
        updated = 0;
      const productsByCode = new Map(
        state.products.map((product) => [product.code, product]),
      );
      const authoritative = parseContext.source.id === "preview";
      await bridge.batch(async () => {
        for (const source of parseContext.candidates) {
          let p = productsByCode.get(source.code);
          const isNew = !p;
          if (isNew) {
            p = newProduct(source.code, source.name, source.facts);
            state.products.push(p);
            productsByCode.set(p.code, p);
            created++;
          } else updated++;
          if (authoritative && source.present.metadata) {
            p.name = source.name;
            p.facts = source.facts;
          } else {
            p.name = source.name || p.name;
            p.facts = source.facts || p.facts;
          }
          if ((authoritative && source.present.photo) || source.photos.length) {
            const next = source.photos;
            if (JSON.stringify(productPhotos(p)) !== JSON.stringify(next)) {
              p.photoThumbnail = null;
              for (const task of p.tasks) delete task.realPhotoIndices;
            }
            p.photos = [...next];
            p.photo = next[0] || "";
          }
          for (const item of source.tasks) {
            const t = p.tasks.find((t) => t.role === item.role);
            if (
              (authoritative && item.present.references) ||
              item.references.length
            ) {
              if (
                item.references[0] !== t.references[0] ||
                !item.references.length ||
                (item.references.length > 1 &&
                  JSON.stringify(item.references) !==
                    JSON.stringify(t.references))
              )
                t.references = item.references;
            }
            if (
              ((authoritative && item.present.prompt) || item.prompt) &&
              item.prompt !== t.prompt
            )
              savePrompt(t, item.prompt);
            if (item.result) {
              const version =
                t.versions.find((v) => v.source === item.result) ||
                addVersion(t, item.result, item.prompt || t.prompt, "imported");
              setPrimary(t, version.id);
            } else if (authoritative && item.present.result) {
              t.primaryId = null;
              t.selectedIds = [];
            }
          }
          if (isNew && parseContext.source.id !== "preview")
            bridge.appendProduct(p);
          else {
            updateMetadata(p, p.code, true);
          }
          for (const t of p.tasks)
            for (const k of ["reference", "prompt", "result"])
              await syncTask(p, t, k, true);
          bridge.markProductParsed(p.code);
        }
      });
      if (parseContext.candidates[0])
        state.activeProductId = state.products.find(
          (p) => p.code === parseContext.candidates[0].code,
        ).id;
      change();
      await context.persist();
      closeModal();
      await switchView("workbench");
      notify(`已保存并解析：新增 ${created} 个，更新 ${updated} 个产品`);
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
    renderParser,
    confirmParse,
    updateParser,
    resolveSheetConflict: (key, prefer) =>
      context.bridge.resolveConflict(key, prefer),
  };
}
