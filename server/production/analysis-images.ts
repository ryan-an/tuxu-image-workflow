import sharp from "sharp";

// Shared by all workspaces so large image decodes cannot multiply per team.
export class AnalysisImagePool {
  private active = 0;
  private waiting: Array<{ start: () => void }> = [];
  constructor(private limit = 2) {}
  async run<T>(
    signal: AbortSignal | undefined,
    work: () => Promise<T>,
  ): Promise<T> {
    signal?.throwIfAborted();
    if (this.active >= this.limit) {
      await new Promise<void>((resolve, reject) => {
        const entry = {
          start: () => {
            signal?.removeEventListener("abort", abort);
            resolve();
          },
        };
        const abort = () => {
          this.waiting = this.waiting.filter((item) => item !== entry);
          reject(signal?.reason);
        };
        this.waiting.push(entry);
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      });
    } else this.active++;
    try {
      signal?.throwIfAborted();
      return await work();
    } finally {
      const next = this.waiting.shift();
      if (next) next.start();
      else this.active--;
    }
  }
}
export const defaultAnalysisImagePool = new AnalysisImagePool();
export async function analysisImage(bytes: Buffer, mime: string) {
  const image = sharp(bytes, { limitInputPixels: 100_000_000 });
  const metadata = await image.metadata();
  // Small originals retain all detail and do not need lossy recompression.
  if (
    (metadata.width || 0) <= 2048 &&
    (metadata.height || 0) <= 2048 &&
    bytes.length <= 2 * 1024 * 1024 &&
    (!metadata.orientation || metadata.orientation === 1)
  )
    return { bytes, mime, converted: false };
  for (const quality of [90, 82, 74, 66, 58]) {
    const result = await image
      .clone()
      .rotate()
      .flatten({ background: "#ffffff" })
      .resize(2048, 2048, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    if (result.length <= 2 * 1024 * 1024)
      return { bytes: result, mime: "image/jpeg", converted: true };
  }
  const result = await image
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 72 })
    .toBuffer();
  if (result.length > 2 * 1024 * 1024)
    throw Error("分析图片仍然过大，请使用较小的参考图");
  return { bytes: result, mime: "image/jpeg", converted: true };
}
