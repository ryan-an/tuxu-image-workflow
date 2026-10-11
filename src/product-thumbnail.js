export const THUMBNAIL_SIZE = 96;
export const THUMBNAIL_MAX_BYTES = 12 * 1024;
const sourceCache = new Map();

export function thumbnailBytes(data) {
  const base64 = data?.split(",")[1] || "";
  return Math.ceil((base64.length * 3) / 4);
}
export function thumbnailSource(product) {
  const thumbnail = product.photoThumbnail;
  return thumbnail?.width > 0 &&
    thumbnail?.height > 0 &&
    thumbnail.width <= THUMBNAIL_SIZE &&
    thumbnail.height <= THUMBNAIL_SIZE &&
    (/^data:image\/(webp|png|jpeg);base64,/.test(thumbnail.data) || /^\/api\/assets\/[a-f0-9]{64}$/.test(thumbnail.data)) &&
    thumbnailBytes(thumbnail.data) <= THUMBNAIL_MAX_BYTES
    ? thumbnail.data
    : "";
}
async function sourceHash(source) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(source),
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
async function compress(source, hash) {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = source;
  await image.decode();
  const canvas = document.createElement("canvas");
  for (const [size, quality] of [
    [96, 0.65],
    [96, 0.45],
    [72, 0.5],
    [48, 0.5],
    [32, 0.45],
  ]) {
    const scale = Math.min(
      1,
      size / Math.max(image.naturalWidth, image.naturalHeight),
    );
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL("image/webp", quality);
    if (thumbnailBytes(data) <= THUMBNAIL_MAX_BYTES)
      return {
        data,
        width: canvas.width,
        height: canvas.height,
        sourceHash: hash,
      };
  }
  throw new Error("无法将缩略图压缩到指定大小");
}
export async function productThumbnail(source, existing) {
  if (!source) return null;
  if (!sourceCache.has(source)) {
    const work = (async () => {
      const hash = await sourceHash(source);
      if (
        existing?.sourceHash === hash &&
        thumbnailSource({ photoThumbnail: existing })
      )
        return existing;
      return compress(source, hash);
    })();
    sourceCache.set(source, work);
    work.catch(() => sourceCache.delete(source));
    // Bound the temporary cache; persisted thumbnails live with their product.
    if (sourceCache.size > 32)
      sourceCache.delete(sourceCache.keys().next().value);
  }
  return sourceCache.get(source);
}
