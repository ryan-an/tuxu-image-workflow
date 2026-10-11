import { newProduct, setPrimary, savePrompt, addVersion } from "../model.js";

import { detectColumns, parseSheet, imageCell } from "../sheet-bridge.js";

export function createSheet(context) {
  let parseContext = null;
  async function syncTask(p, t, kind) {
    const { bridge, notify } = context;
    try {
      await bridge.sync(p, t, kind);
    } catch (error) {
      notify(`结果已保留，表格回填失败：${error.message}`);
      throw error;
    }
  }

  function updateMetadata(product, oldCode = product.code) {
    const { state, bridge } = context;
    const snap = bridge.snapshot(),
      sheet = snap.sheets.preview,
      mapping = detectColumns(sheet);
    const target = bridge.workbook?.getSheetBySheetId("preview");
    for (const [r, cells] of Object.entries(sheet.cellData)) {
      if (String(cells[mapping.codeColumn]?.v) !== oldCode) continue;
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
      if (cells[mapping.typeColumn]?.v === "示例图" && mapping.photoColumn >= 0)
        writes.push([mapping.photoColumn, imageCell(product.photo)]);
      for (const [column, cell] of writes)
        if (column >= 0) {
          if (target) target.getRange(Number(r), column, 1, 1).setValue(cell);
          else cells[column] = cell;
        }
    }
    state.sheetSnapshot = snap;
    bridge.capture();
  }

  async function switchView(next) {
    const { bridge, render, setView } = context;
    setView(next);
    render();
    if (next === "sheet") await bridge.mount();
    else bridge.capture();
  }

  function openParser() {
    const { bridge, renderParser } = context;
    if (!bridge.workbook) return;
    const source =
      bridge.workbook.save().sheets[
        bridge.workbook.getActiveSheet().getSheetId()
      ];
    parseContext = {
      source,
      mapping: detectColumns(source),
      layout: "auto",
      candidates: [],
    };
    renderParser();
  }

  function renderParser() {
    const { ui, publish, showModal } = context;
    parseContext.candidates = parseSheet(
      parseContext.source,
      parseContext.mapping,
      parseContext.layout,
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
    for (const source of parseContext.candidates) {
      let p = state.products.find((p) => p.code === source.code);
      const isNew = !p;
      if (isNew) {
        p = newProduct(source.code, source.name, source.facts);
        state.products.push(p);
        created++;
      } else updated++;
      p.name = source.name || p.name;
      p.facts = source.facts || p.facts;
      p.photo = source.photo || p.photo;
      for (const item of source.tasks) {
        const t = p.tasks.find((t) => t.role === item.role);
        if (item.references.length) t.references = item.references;
        if (item.prompt) savePrompt(t, item.prompt);
        if (item.result && !t.versions.some((v) => v.source === item.result))
          setPrimary(
            t,
            addVersion(t, item.result, item.prompt || t.prompt, "imported").id,
          );
      }
      if (isNew) bridge.appendProduct(p);
      else {
        updateMetadata(p);
      }
      if (!isNew)
        for (const t of p.tasks)
          for (const k of ["reference", "prompt", "result"])
            await syncTask(p, t, k);
    }
    if (parseContext.candidates[0])
      state.activeProductId = state.products.find(
        (p) => p.code === parseContext.candidates[0].code,
      ).id;
    closeModal();
    await switchView("workbench");
    change();
    notify(`已解析：新增 ${created} 个，更新 ${updated} 个产品`);
  }

  function updateParser(field, roleIndex, value) {
    const { renderParser } = context;
    if (roleIndex != null) parseContext.mapping.roles[roleIndex] = value;
    else if (field === "layout") parseContext.layout = value;
    else parseContext.mapping[field] = value;
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
  };
}
