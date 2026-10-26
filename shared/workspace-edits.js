// Only these fields are editable. Worker-owned history and execution state never
// travel back through the editor's save endpoint.
import {
  DEFAULT_PROMPT_CONCURRENCY,
  DEFAULT_QUERY_CONCURRENCY,
} from "./execution-settings.js";
export function editable(workspace) {
  return {
    common: workspace.common,
    promptTemplates: workspace.promptTemplates ?? {},
    concurrency: workspace.concurrency,
    promptConcurrency:
      workspace.promptConcurrency ?? DEFAULT_PROMPT_CONCURRENCY,
    queryConcurrency: workspace.queryConcurrency ?? DEFAULT_QUERY_CONCURRENCY,
    ...(workspace.sheetLoaded === false
      ? {}
      : { sheetSnapshot: workspace.sheetSnapshot ?? null }),
    products: Object.fromEntries(
      workspace.products
        .filter((p) => !p._summary)
        .map((p) => [
          p.id,
          {
            id: p.id,
            code: p.code,
            name: p.name,
            facts: p.facts,
            promptRequirements: p.promptRequirements ?? null,
            photo: p.photo || "",
            photos: p.photos || [],
            photoThumbnail: p.photoThumbnail ?? null,
            tasks: Object.fromEntries(
              p.tasks.map((t) => [
                t.id,
                {
                  id: t.id,
                  role: t.role,
                  references: t.references,
                  prompt: t.prompt,
                  primaryId: t.primaryId,
                  selectedIds: t.selectedIds,
                  imports: t.versions.filter(
                    (version) => version.origin === "imported",
                  ),
                },
              ]),
            ),
          },
        ]),
    ),
  };
}
export const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function cellContent(cell) {
  const richText = cell?.p?.body?.dataStream?.replace(/[\r\b\n]+$/g, "") || "";
  return {
    v: String(
      cell?.v === "" && richText ? richText : (cell?.v ?? richText),
    ).replace(/\r\n?/g, "\n"),
    images: Object.values(cell?.p?.drawings || {})
      .map((drawing) => drawing.source)
      .filter(Boolean),
    f: cell?.f || "",
  };
}
export function differences(before, after, path = []) {
  if (equal(before, after)) return [];
  if (
    path.at(-1) === "photoThumbnail" ||
    (path[0] === "sheetSnapshot" && path[3] === "cellData" && path.length === 6)
  )
    return [{ path, before: before ?? null, value: after ?? null }];
  if (
    path[0] === "sheetSnapshot" &&
    before == null &&
    after &&
    typeof after === "object" &&
    !Array.isArray(after)
  )
    before = {};
  if (
    before &&
    after &&
    !Array.isArray(before) &&
    !Array.isArray(after) &&
    typeof before === "object" &&
    typeof after === "object"
  ) {
    return [
      ...new Set([...Object.keys(before), ...Object.keys(after)]),
    ].flatMap((key) => differences(before[key], after[key], [...path, key]));
  }
  return [{ path, before: before ?? null, value: after ?? null }];
}
// Expand old whole-workbook saves too, so already-open pages cannot replace
// unrelated cells when they eventually submit their local snapshot.
export function incrementalEdits(edits) {
  return edits.flatMap((edit) =>
    edit.path[0] === "sheetSnapshot" &&
    edit.path.length === 1 &&
    edit.before &&
    edit.value
      ? differences(edit.before, edit.value, edit.path)
      : [edit],
  );
}
export function applyLatestEdits(target, edits) {
  for (const edit of incrementalEdits(edits)) {
    if (
      !Array.isArray(edit.path) ||
      !edit.path.length ||
      edit.path.some(
        (key) =>
          typeof key !== "string" ||
          ["__proto__", "constructor", "prototype"].includes(key),
      )
    )
      throw new Error("无效的编辑路径");
    // Two browsers may both initialise the sheet. Merge the incoming initial
    // snapshot by leaf instead of replacing cells already saved by another tab.
    if (
      edit.path[0] === "sheetSnapshot" &&
      edit.path.length === 1 &&
      edit.before == null &&
      edit.value &&
      target.sheetSnapshot
    ) {
      applyLatestEdits(target, differences({}, edit.value, edit.path));
      continue;
    }
    let parent = target;
    for (const key of edit.path.slice(0, -1)) {
      if (!parent || typeof parent !== "object")
        throw new Error("编辑目标已不存在");
      if (!Object.hasOwn(parent, key) || parent[key] == null) {
        if (edit.path[0] !== "sheetSnapshot")
          throw new Error("编辑目标已不存在");
        parent[key] = {};
      }
      parent = parent[key];
    }
    if (
      edit.path[0] === "sheetSnapshot" &&
      edit.path.length > 1 &&
      edit.value == null
    ) {
      delete parent[edit.path.at(-1)];
      continue;
    }
    if (
      edit.path[0] === "sheetSnapshot" &&
      edit.path[3] === "cellData" &&
      edit.path.length === 6 &&
      edit.value &&
      (edit.before == null || typeof edit.before === "object") &&
      typeof edit.value === "object"
    ) {
      // A cell's style/metadata normalization must not replay its stale text.
      // Rich text (`p`) stays atomic; only properties actually edited are sent
      // over the latest cell already committed by another browser.
      const key = edit.path.at(-1);
      const next = { ...(parent[key] || {}) };
      const beforeCell = edit.before || {};
      const preserveContent =
        equal(cellContent(beforeCell), cellContent(edit.value)) &&
        !equal(cellContent(beforeCell), cellContent(next));
      for (const property of new Set([
        ...Object.keys(beforeCell),
        ...Object.keys(edit.value),
      ])) {
        if (["__proto__", "constructor", "prototype"].includes(property))
          throw new Error("无效的编辑路径");
        if (preserveContent && ["v", "p", "f", "t"].includes(property))
          continue;
        if (!equal(beforeCell[property] ?? null, edit.value[property] ?? null))
          next[property] = structuredClone(edit.value[property] ?? null);
      }
      if (next.v === "" && next.p?.body?.dataStream?.replace(/[\r\b\n]+$/g, ""))
        delete next.v;
      parent[key] = next;
      continue;
    }
    applyEdits(target, [edit], false);
  }
  return target;
}
export function applyEdits(target, edits, check = true) {
  for (const edit of edits) {
    if (
      !Array.isArray(edit.path) ||
      !edit.path.length ||
      edit.path.some(
        (p) =>
          typeof p !== "string" ||
          ["__proto__", "constructor", "prototype"].includes(p),
      )
    )
      throw new Error("无效的编辑路径");
    let parent = target;
    for (const key of edit.path.slice(0, -1)) {
      if (!parent || !Object.hasOwn(parent, key))
        throw new Error("编辑目标已不存在");
      parent = parent[key];
    }
    const key = edit.path.at(-1);
    if (check && !equal(parent[key] ?? null, edit.before))
      throw new Error("资料已在其他页面或后台更新，请保留草稿并刷新后重试");
    parent[key] = structuredClone(edit.value);
  }
  return target;
}
export function mergeView(state, remote, pending = []) {
  const projection = applyLatestEdits(
    structuredClone(editable(remote)),
    pending,
  );
  const products = remote.products.map((p) => {
    const e = projection.products[p.id];
    if (!e) return p;
    const { tasks, ...fields } = e;
    return {
      ...p,
      ...fields,
      tasks: p.tasks.map((t) => {
        const { imports = [], ...fields } = tasks[t.id];
        return {
          ...t,
          ...fields,
          versions: [
            ...t.versions,
            ...imports.filter(
              (version) =>
                !t.versions.some((existing) => existing.id === version.id),
            ),
          ],
        };
      }),
    };
  });
  for (const [id, p] of Object.entries(projection.products)) {
    if (!p) continue;
    if (!products.some((existing) => existing.id === id))
      products.push({
        ...p,
        promptSets: [],
        tasks: Object.values(p.tasks).map(({ imports = [], ...t }) => ({
          ...t,
          revision: 0,
          promptHistory: [],
          versions: imports,
        })),
      });
  }
  const activeProductId = state.activeProductId;
  Object.assign(state, remote, {
    products,
    common: projection.common,
    promptTemplates: projection.promptTemplates,
    concurrency: projection.concurrency,
    promptConcurrency: projection.promptConcurrency,
    queryConcurrency: projection.queryConcurrency,
    sheetSnapshot: projection.sheetSnapshot,
    activeProductId,
  });
}
