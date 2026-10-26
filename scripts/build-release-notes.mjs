import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { projectDirectory } from "./docker-common.mjs";

const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const list = (items, tag = "li") =>
  items.map((item) => `<${tag}>${escape(item)}</${tag}>`).join("");

export function renderRelease(release, releases, css) {
  const content = release.features
    ? release
    : releases.find((item) => item.version === release.notesVersion);
  if (!content?.features)
    throw new Error(`版本 ${release.version} 缺少完整的功能说明`);
  const features = content.features;
  const latest = releases[0].version === release.version;
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escape(release.summary || content.summary)}"><title>图序 v${escape(release.version)} · 更新日志</title><style>${css}</style></head>
<body><header><div class="header-inner"><a class="brand" href="./index.html"><b>图</b><span>图序 <small>产品更新日志</small></span></a><a class="back" href="/">返回工作台 ↗</a></div></header>
<div class="layout"><aside class="sidebar"><div><p>本版内容</p><nav aria-label="本版目录">${features.map((item) => `<a href="#${escape(item.id)}">${escape(content.highlights[features.indexOf(item)])}</a>`).join("")}<a href="#fixes">问题修复</a></nav></div><details class="versions" open><summary>版本记录</summary><ul>${releases.map((item) => `<li><a href="./v${escape(item.version)}.html"${item.version === release.version ? ' aria-current="page"' : ""}><strong>v${escape(item.version)}</strong><time datetime="${escape(item.date)}">${escape(item.date)}</time></a></li>`).join("")}</ul></details></aside>
<main><section class="hero"><div class="eyebrow"><span class="version-pill">v${escape(release.version)}</span><time datetime="${escape(release.date)}">${escape(release.date.replaceAll("-", "."))}</time>${latest ? '<span class="latest">当前版本</span>' : ""}</div><h1>${escape(release.title)}</h1><p>${escape(release.summary || content.summary)}</p><div class="highlights">${list(content.highlights, "span")}</div>${release.notesVersion ? `<p class="inherited">以下为 v${escape(content.version)} 起提供的主要功能与使用方法。${release.note ? escape(release.note) : ""}</p>` : ""}</section>
${features.map((feature, index) => `<section class="section" id="${escape(feature.id)}"><div class="section-head"><span class="number">${String(index + 1).padStart(2, "0")}</span><h2>${escape(feature.title)}</h2></div><p class="intro">${escape(feature.intro)}</p><ol class="steps">${list(feature.steps)}</ol><figure><div class="figure-top"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><span>图序 · 实际界面 · 演示资料</span><span>点击图片可放大 ↗</span></div><a href="./images/v${escape(content.version)}/${escape(feature.image)}" target="_blank" rel="noopener"><img src="./images/v${escape(content.version)}/${escape(feature.image)}" alt="${escape(feature.alt)}" loading="lazy" decoding="async"></a><figcaption>${escape(feature.caption)}</figcaption></figure></section>`).join("\n")}
<section class="section" id="fixes"><div class="section-head"><span class="number">06</span><h2>${release.notesVersion ? `v${escape(content.version)} 起的体验改进` : "这些使用问题，也一起修好了"}</h2></div><div class="fixes"><ul>${list(content.fixes)}</ul></div></section><aside class="tips"><p>开始使用前的小提示</p><ul>${list(content.tips)}</ul></aside><footer class="footer"><span>图序 · 批量生图工作台</span><span>v${escape(release.version)} · ${escape(release.date)} · 更新说明</span></footer></main></div></body></html>\n`;
}

export async function buildReleaseNotes(root = projectDirectory) {
  const { releases } = JSON.parse(
    await readFile(join(root, "docs/releases/releases.json"), "utf8"),
  );
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  if (!releases.length || releases[0].version !== pkg.version)
    throw new Error(
      "应用版本与更新日志版本不一致，请使用 release 命令维护版本。",
    );
  const css = await readFile(join(root, "docs/releases/page.css"), "utf8");
  const output = join(root, "public/updates");
  await mkdir(output, { recursive: true });
  for (const release of releases) {
    if (!/^\d+\.\d+\.\d+$/.test(release.version))
      throw new Error("无效的更新日志版本号");
    for (const feature of release.features || []) {
      if (!/^[a-z-]+\.webp$/.test(feature.image))
        throw new Error("无效的功能截图文件名");
      const target = join(
        output,
        "images",
        `v${release.version}`,
        feature.image,
      );
      await mkdir(dirname(target), { recursive: true });
      await copyFile(
        join(root, "docs/releases", `v${release.version}`, feature.image),
        target,
      );
    }
    await writeFile(
      join(output, `v${release.version}.html`),
      renderRelease(release, releases, css),
    );
  }
  await writeFile(
    join(output, "index.html"),
    renderRelease(releases[0], releases, css),
  );
  const version = {
    version: pkg.version,
    date: releases[0].date,
    releaseNotes: `/updates/v${pkg.version}.html`,
  };
  await writeFile(
    join(root, "public/version.json"),
    JSON.stringify(version, null, 2) + "\n",
  );
  return version;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  buildReleaseNotes()
    .then((release) =>
      console.log(`已生成 v${release.version} 静态更新日志：public/updates/`),
    )
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
