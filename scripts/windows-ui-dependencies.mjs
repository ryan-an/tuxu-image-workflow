import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import JSZip from "jszip";

// Only the maintainer's build needs NuGet access. Both EXEs embed this assembly.
export async function prepareDesktopUi(root, staging) {
  const lock = JSON.parse(await readFile(join(root, "scripts/windows/desktop-ui.lock.json"), "utf8"));
  const cache = join(root, ".npm-cache/windows-ui");
  await mkdir(cache, { recursive: true });
  const cached = join(cache, `${lock.name}-${lock.version}.nupkg`);
  let bytes;
  try { bytes = await readFile(cached); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const digest = (data) => createHash("sha256").update(data).digest("hex");
  if (!bytes || digest(bytes) !== lock.sha256) {
    const response = await fetch(lock.url);
    if (!response.ok) throw new Error(`无法下载桌面界面组件：${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (digest(bytes) !== lock.sha256) throw new Error("桌面界面组件校验失败，已终止打包");
    await writeFile(cached, bytes);
  }
  const zip = await JSZip.loadAsync(bytes);
  const assembly = join(staging, "AntdUI.dll");
  await writeFile(assembly, await zip.file(lock.assembly).async("nodebuffer"));
  // Generate native theme values from the platform's single source of truth.
  const css = await readFile(join(root, "src/ui/design-system/tokens.css"), "utf8");
  const declarations = [...css.matchAll(/--([\w-]+):\s*(#[\da-f]{6}|\d+px)\s*;/gi)];
  const fields = declarations.map(([, name, value]) => {
    const field = name.replace(/(^|-)(\w)/g, (_, _dash, letter) => letter.toUpperCase());
    return value.startsWith("#")
      ? `internal static readonly System.Drawing.Color ${field} = System.Drawing.ColorTranslator.FromHtml("${value}");`
      : `internal const int ${field} = ${parseInt(value, 10)};`;
  });
  const theme = join(staging, "DesktopTokens.cs");
  await writeFile(theme, `// Generated from src/ui/design-system/tokens.css.\ninternal static class DesktopTokens {\n${fields.join("\n")}\n}\n`);
  return { assembly, theme };
}
