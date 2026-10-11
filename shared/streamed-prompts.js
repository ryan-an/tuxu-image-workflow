import { ROLES } from "./model.js";
function stringAt(source, start) {
  let raw = "";
  for (let i = start; i < source.length; i++) {
    if (source[i] === '"') break;
    if (source[i] === "\\") {
      const size = source[i + 1] === "u" ? 6 : 2;
      if (i + size > source.length) break;
      raw += source.slice(i, i + size);
      i += size - 1;
    } else raw += source[i];
  }
  try {
    return JSON.parse('"' + raw + '"');
  } catch {
    return "";
  }
}
function field(source, name) {
  const match = new RegExp('(?<!\\\\)"' + name + '"\\s*:\\s*"').exec(source);
  return match ? stringAt(source, match.index + match[0].length) : "";
}
// Partial output is a read-only preview, never a saved generation prompt.
/** @returns {Record<string, string>} */
export function streamedPrompts(source) {
  const style = field(source, "style"),
    result = {};
  const starts = [...source.matchAll(/(?<!\\)"role"\s*:\s*"/g)];
  for (let i = 0; i < starts.length; i++) {
    const block = source.slice(starts[i].index, starts[i + 1]?.index),
      role = field(block, "role");
    if (!ROLES.includes(role)) continue;
    const copies = [],
      copyStart = /"copy"\s*:\s*\[/.exec(block);
    if (copyStart) {
      let cursor = copyStart.index + copyStart[0].length;
      while (cursor < block.length) {
        while (/[\s,]/.test(block[cursor] || "x")) cursor++;
        if (block[cursor] !== '"') break;
        copies.push(stringAt(block, ++cursor));
        for (; cursor < block.length; cursor++) {
          if (block[cursor] === "\\") {
            cursor++;
            continue;
          }
          if (block[cursor] === '"') {
            cursor++;
            break;
          }
        }
      }
    }
    result[role] = [
      ["统一设计", style],
      ["版面布局", field(block, "layout")],
      ["图上文案", copies.join("\n")],
      ["产品要求", field(block, "thirdPart")],
      ["图片尺寸", field(block, "fourthPart")],
    ]
      .filter(([, value]) => value)
      .map(([label, value]) => label + "\n" + value)
      .join("\n\n");
  }
  return result;
}
