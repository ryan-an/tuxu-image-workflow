import { AUTO_SIZE_DEFAULTS } from "./generation-settings.js";
export const MODELS = [
  "nano-banana",
  "nano-banana-fast",
  "nano-banana-2",
  "nano-banana-2-cl",
  "nano-banana-2-2k-cl",
  "nano-banana-2-4k-cl",
  "nano-banana-pro",
  "nano-banana-pro-vt",
  "nano-banana-pro-cl",
  "nano-banana-pro-vip",
  "nano-banana-pro-4k-vip",
  "gpt-image-2",
  "gpt-image-2-vip",
  "gpt-image-2.5",
  "gpt-image-2.5-flare",
  "gpt-image-2.5-sunburst",
];
export const DEFAULT_CONFIG = {
  mode: "demo",
  baseUrl: "https://grsai.dakka.com.cn",
  imageModel: "nano-banana-2",
  promptModel: "gemini-3.1-pro",
  ...AUTO_SIZE_DEFAULTS,
  quality: "auto",
};
export function baseUrl(value) {
  const url = new URL(value || DEFAULT_CONFIG.baseUrl);
  if (
    url.protocol !== "https:" ||
    !["grsaiapi.com", "grsai.dakka.com.cn"].includes(url.hostname) ||
    url.port ||
    url.username ||
    url.password
  )
    throw new Error("请选择 Grsai 国内或全球节点");
  return url.origin;
}
export function generationPayload(config, input) {
  const model = config.imageModel || DEFAULT_CONFIG.imageModel;
  if (!MODELS.includes(model)) throw new Error("不支持的生图模型");
  if (!input.prompt?.trim()) throw new Error("提示词不能为空");
  const body = {
    model,
    prompt: input.prompt,
    images: input.referenceImages || [],
    replyType: "async",
  };
  if (model.startsWith("gpt-")) {
    body.aspectRatio = config.gptSize || "auto";
    const supported = model.endsWith("sunburst")
      ? ["low", "medium", "high", "xhigh", "max"]
      : model.endsWith("flare")
        ? ["low", "medium", "high"]
        : model.endsWith("vip")
          ? ["medium"]
          : ["auto"];
    body.quality = config.quality || supported[0];
    if (!supported.includes(body.quality))
      throw new Error(`${model} 不支持 ${body.quality} 质量，请调整设置`);
    const vip = /vip|flare|sunburst/.test(model);
    if (vip && body.aspectRatio !== "auto") {
      const dimensions = /^(\d+)x(\d+)$/.exec(body.aspectRatio);
      if (!dimensions)
        throw new Error("该 GPT 模型需要像素尺寸，例如 1024x1024");
      const w = Number(dimensions[1]),
        h = Number(dimensions[2]),
        pixels = w * h;
      if (
        w % 16 ||
        h % 16 ||
        Math.max(w, h) > 3840 ||
        Math.max(w, h) / Math.min(w, h) > 3 ||
        pixels < 655360 ||
        pixels > 8294400
      )
        throw new Error("GPT 像素尺寸不符合平台约束");
    }
  } else {
    body.aspectRatio = config.aspectRatio || "auto";
    // The provider exposes 1K/2K/4K. Application auto leaves imageSize unspecified.
    if (config.imageSize && config.imageSize !== "auto") {
      if (!["1K", "2K", "4K"].includes(config.imageSize))
        throw new Error("请选择 auto、1K、2K 或 4K 分辨率");
      body.imageSize = config.imageSize;
    }
  }
  return body;
}
