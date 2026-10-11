// Only these fields are editable. Worker-owned history and execution state never
// travel back through the editor's save endpoint.
export function editable(workspace) {
  return {
    common: workspace.common,
    concurrency: workspace.concurrency,
    sheetSnapshot: workspace.sheetSnapshot ?? null,
    products: Object.fromEntries(
      workspace.products.map((p) => [
        p.id,
        {
          id: p.id,
          code: p.code,
          name: p.name,
          facts: p.facts,
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
              },
            ]),
          ),
        },
      ]),
    ),
  };
}
export const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function differences(before, after, path = []) {
  if (equal(before, after)) return [];
  if (path[0] === "sheetSnapshot" || path.at(-1) === "photoThumbnail")
    return [{ path, before: before ?? null, value: after ?? null }];
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
  const projection = applyEdits(editable(remote), pending, false);
  const products = remote.products.map((p) => {
    const e = projection.products[p.id];
    if (!e) return p;
    const { tasks, ...fields } = e;
    return {
      ...p,
      ...fields,
      tasks: p.tasks.map((t) => ({ ...t, ...tasks[t.id] })),
    };
  });
  for (const [id, p] of Object.entries(projection.products)) {
    if (!p) continue;
    if (!products.some((existing) => existing.id === id))
      products.push({
        ...p,
        promptSets: [],
        tasks: Object.values(p.tasks).map((t) => ({
          ...t,
          revision: 0,
          promptHistory: [],
          versions: [],
        })),
      });
  }
  const activeProductId = state.activeProductId;
  Object.assign(state, remote, {
    products,
    common: projection.common,
    concurrency: projection.concurrency,
    sheetSnapshot: projection.sheetSnapshot,
    activeProductId,
  });
}
