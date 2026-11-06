import { normalizePromptRole } from "./prompt-roles.js";
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
function imageBlocks(source) {
  const images = /(?<!\\)"images"\s*:\s*\[/.exec(source);
  if (!images) return [];
  const blocks = [];
  let start = -1,
    depth = 0,
    quoted = false,
    escaped = false;
  for (let i = images.index + images[0].length; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{") {
      if (depth++ === 0) start = i;
    } else if (char === "}" && --depth === 0) {
      blocks.push(source.slice(start, i + 1));
      start = -1;
    } else if (char === "]" && depth === 0) break;
  }
  if (start >= 0) blocks.push(source.slice(start));
  return blocks;
}
// Decode the model's prompt string for preview without rewriting its contents.
/** @returns {Record<string, string>} */
export function streamedPrompts(source) {
  const result = {};
  for (const block of imageBlocks(source)) {
    const role = normalizePromptRole(field(block, "role")),
      prompt = field(block, "prompt");
    if (role && prompt) result[role] = prompt;
  }
  return result;
}
