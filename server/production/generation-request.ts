import { AppError } from "./types.js";

// Application transport budget, not a claimed Grsai per-image/API limit.
// Count actual UTF-8 JSON including Base64, prompts, URL prefixes and settings.
export const GENERATION_REQUEST_LIMIT = 6_000_000;

export async function generationRequest(
  body: Record<string, any>,
  compress: (source: string, maxBytes: number) => Promise<string>,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (Buffer.byteLength(JSON.stringify(body)) < GENERATION_REQUEST_LIMIT)
    return body;

  const images: string[] = body.images || [];
  const inline = images.map((source) => source.startsWith("data:image/"));
  const fixed = Buffer.byteLength(
    JSON.stringify({
      ...body,
      images: images.map((source, index) => (inline[index] ? "" : source)),
    }),
  );
  // Leave a small margin and preserve small images while sharing the remaining
  // space across larger images. Never drop, reorder or truncate references.
  const available = GENERATION_REQUEST_LIMIT - fixed - 1024;
  const sizes = images
    .filter((_, index) => inline[index])
    .map((source) => Buffer.byteLength(source));
  if (available <= 0 || !sizes.length)
    throw new AppError(
      "本次生图的提示词或图片链接过大，请缩短提示词或减少附图后重试",
    );
  let low = 0,
    high = sizes.reduce((largest, size) => Math.max(largest, size), 0);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (
      sizes.reduce((total, size) => total + Math.min(size, middle), 0) <=
      available
    )
      low = middle;
    else high = middle - 1;
  }
  const cap = low;
  const prepared: string[] = [];
  for (const [index, source] of images.entries()) {
    signal.throwIfAborted();
    if (!inline[index] || Buffer.byteLength(source) <= cap) {
      prepared.push(source);
      continue;
    }
    const prefix = Math.max(
      source.indexOf(",") + 1,
      "data:image/webp;base64,".length,
    );
    const maxBytes = Math.floor((cap - prefix) / 4) * 3;
    if (maxBytes < 1)
      throw new AppError("本次附图过多，没有足够的图片空间，请减少附图后重试");
    prepared.push(await compress(source, maxBytes));
  }
  const result = { ...body, images: prepared };
  if (Buffer.byteLength(JSON.stringify(result)) >= GENERATION_REQUEST_LIMIT)
    throw new AppError(
      "本次生图提交的数据仍然过大，请减少附图或使用较小图片后重试",
    );
  return result;
}
