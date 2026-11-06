import sharp from "sharp";
import { AppError } from "./types.js";

export const UPLOAD_IMAGE_LIMIT = 6 * 1024 * 1024;

export async function uploadedImage(bytes: Buffer, mime: string) {
  if (bytes.length <= UPLOAD_IMAGE_LIMIT) return { bytes, mime };

  try {
    const image = sharp(bytes, {
      animated: true,
      limitInputPixels: 100_000_000,
    });
    const metadata = await image.metadata();
    let width = metadata.width!,
      height = metadata.pageHeight || metadata.height!;
    if (!width || !height) throw new Error("Missing image dimensions");
    // Keep animation and transparency; only reduce dimensions if quality alone
    // cannot bring the image below the limit. Orientation is baked into stills.
    if ((metadata.pages || 1) === 1) {
      image.rotate();
      if ((metadata.orientation || 1) >= 5) [width, height] = [height, width];
    }
    const initialScale = Math.min(1, 16383 / Math.max(width, height));
    width = Math.max(1, Math.floor(width * initialScale));
    height = Math.max(1, Math.floor(height * initialScale));
    while (true) {
      let size = bytes.length;
      for (const quality of [95, 85, 75]) {
        const result = await image
          .clone()
          .resize(width, height, { fit: "inside", withoutEnlargement: true })
          .webp({ quality })
          .toBuffer();
        if (result.length < UPLOAD_IMAGE_LIMIT)
          return { bytes: result, mime: "image/webp" };
        size = result.length;
      }
      if (width === 1 && height === 1) break;
      const scale = Math.min(0.85, Math.sqrt(UPLOAD_IMAGE_LIMIT / size) * 0.95);
      width = Math.max(1, Math.floor(width * scale));
      height = Math.max(1, Math.floor(height * scale));
    }
  } catch {
    throw new AppError("图片自动压缩失败，请选择有效或较小的图片后重试");
  }
  throw new AppError("图片无法压缩到 6MB 以下，请选择较小的图片后重试");
}
