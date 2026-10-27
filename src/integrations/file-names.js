// Product codes are business identifiers. Adapt them only at the filesystem
// boundary, preserving the original value in records, sheets and exports.
export function safeFileComponent(value) {
  const name = String(value)
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();
  if (!name) return "未命名";
  return /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)
    ? `_${name}`
    : name;
}
