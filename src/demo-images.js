import { newProduct, addVersion, rulePrompt } from "./model.js";
import { DEFAULT_COMMON, demoSuite } from "./prompt-suite.js";
import { AUTO_SIZE_DEFAULTS } from "./generation-settings.js";
export function demoImage(product, role, variant = 0) {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 520;
  const ctx = canvas.getContext("2d");
  const cloth = product.name.includes("布") || product.name.includes("缎");
  const bg = ctx.createLinearGradient(0, 0, 640, 520);
  bg.addColorStop(0, variant % 2 ? "#e1eadf" : "#f0e9da");
  bg.addColorStop(1, "#f8f7f1");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 640, 520);
  ctx.fillStyle = "#304439";
  ctx.font = "600 20px Microsoft YaHei";
  ctx.fillText(role, 34, 48);
  ctx.fillStyle = "#6f796e";
  ctx.font = "13px sans-serif";
  ctx.fillText("PRODUCT VISUAL STUDY", 34, 76);
  if (cloth) {
    const gradient = ctx.createLinearGradient(40, 150, 590, 350);
    [
      [0, "#09120e"],
      [0.17, "#607464"],
      [0.3, "#152a1e"],
      [0.5, "#6b8772"],
      [0.64, "#0b1c12"],
      [1, "#3c5745"],
    ].forEach(([s, c]) => gradient.addColorStop(s, c));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(90, 170);
    ctx.bezierCurveTo(225, 90, 420, 170, 550, 180);
    ctx.lineTo(570, 350);
    ctx.bezierCurveTo(360, 295, 270, 437, 66, 354);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#96ad9570";
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(165 + i * 85, 162);
      ctx.bezierCurveTo(
        100 + i * 90,
        280,
        170 + i * 90,
        320,
        105 + i * 110,
        370,
      );
      ctx.stroke();
    }
  } else {
    ctx.save();
    ctx.translate(320, 268);
    ctx.rotate(-0.12 + variant * 0.035);
    ctx.shadowColor = "#50654644";
    ctx.shadowBlur = 28;
    ctx.fillStyle = "#fdfefc";
    ctx.strokeStyle = "#d0dcc7";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.roundRect(-225, -88, 450, 176, 42);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#e3eadf";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(-199, -61, 398, 122, 28);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = "#567848";
    ctx.beginPath();
    ctx.ellipse(507, 110, 20, 38, -0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  if (role === "尺寸图") {
    ctx.strokeStyle = "#798477";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(75, 415);
    ctx.lineTo(560, 415);
    ctx.stroke();
    ctx.font = "14px Microsoft YaHei";
    ctx.fillText(
      cloth ? "5 YARDS · SATIN" : "27 × 11 cm · SET OF 10",
      165,
      440,
    );
  }
  ctx.fillStyle = "#8e9789";
  ctx.font = "12px Microsoft YaHei";
  ctx.fillText(`演示图片 · ${product.code} · V${variant + 1}`, 34, 491);
  return canvas.toDataURL("image/png");
}
export function initialState(oldSnapshot) {
  const common = DEFAULT_COMMON;
  const products = Array.from({ length: 30 }, (_, i) =>
    newProduct(
      i === 0 ? "26-1732" : i === 1 ? "26-1683" : `26-${1800 + i}`,
      i % 2 ? "透明植物托盘" : "黑色缎面布料",
      i % 2 ? "10 个装 · 27 × 11 cm · 透明塑料" : "5 码装 · 黑色 · 缎面材质",
    ),
  );
  for (const [i, p] of products.entries()) {
    const old = oldSnapshot?.sheets?.overview?.cellData?.[i + 1];
    if (old) {
      p.code = String(old[0]?.v || p.code);
      p.name = String(old[1]?.v || p.name);
      p.facts = String(old[2]?.v || p.facts);
    }
  }
  for (let p = 0; p < 2; p++) {
    const product = products[p];
    product.photo = demoImage(product, "实拍示意");
    const oldPhoto = Object.values(
      oldSnapshot?.sheets?.references?.cellData?.[p + 1]?.[2]?.p?.drawings ||
        {},
    )[0]?.source;
    if (oldPhoto) product.photo = oldPhoto;
    for (let i = 0; i < product.tasks.length; i++) {
      const old = oldSnapshot?.sheets?.references?.cellData?.[p + 1]?.[i + 3];
      const images = Object.values(old?.p?.drawings || {})
        .map((v) => v.source)
        .filter(Boolean);
      product.tasks[i].references = images.length
        ? images
        : [demoImage(product, product.tasks[i].role)];
    }
  }
  const first = products[0].tasks[0];
  first.prompt = demoSuite(products[0]).prompts[0].prompt;
  addVersion(
    first,
    demoImage(products[0], first.role, 0),
    first.prompt,
    "demo",
  );
  addVersion(
    first,
    demoImage(products[0], first.role, 1),
    first.prompt,
    "demo",
  );
  return {
    schema: 2,
    promptWorkflowVersion: 2,
    autoSizeDefaultsVersion: 1,
    products,
    jobs: [],
    common,
    concurrency: 2,
    paused: false,
    activeProductId: products[0].id,
    settings: {
      mode: "demo",
      baseUrl: "https://grsai.dakka.com.cn",
      imageModel: "nano-banana-2",
      promptModel: "gemini-3.1-pro",
      ...AUTO_SIZE_DEFAULTS,
      quality: "auto",
    },
    sheetSnapshot: null,
  };
}
export async function runDemo(product, task, kind, common, signal) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, kind === "prompt" ? 280 : 650);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Cancelled", "AbortError"));
      },
      { once: true },
    );
  });
  return kind === "prompt"
    ? rulePrompt(product, task, common)
    : demoImage(product, task.role, task.versions.length);
}
