// Templates are reusable text, not live links to product requirements.
export function normalizePromptTemplates(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("提示词模板格式无效");
  const entries = Object.entries(value).filter(([, item]) => item !== null);
  if (entries.length > 100) throw new Error("最多保存 100 份提示词模板");
  const names = new Set();
  for (const [id, item] of entries) {
    if (
      !/^[A-Za-z0-9_-]{1,100}$/.test(id) ||
      ["__proto__", "constructor", "prototype"].includes(id) ||
      !item ||
      item.id !== id ||
      typeof item.name !== "string" ||
      !item.name.trim() ||
      item.name !== item.name.trim() ||
      item.name.length > 60 ||
      typeof item.content !== "string" ||
      !item.content.trim() ||
      item.content.length > 100000 ||
      !Number.isSafeInteger(item.updatedAt) ||
      item.updatedAt < 0
    )
      throw new Error("模板需要名称（最多 60 字）和正文（最多 100000 字）");
    const name = item.name.toLocaleLowerCase();
    if (names.has(name)) throw new Error("已有同名模板，请换一个名称");
    names.add(name);
  }
  return Object.fromEntries(
    entries.map(([id, item]) => [
      id,
      {
        id,
        name: item.name,
        content: item.content,
        updatedAt: item.updatedAt,
      },
    ]),
  );
}
