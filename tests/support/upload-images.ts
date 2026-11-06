import sharp from "sharp";

// Padding after IEND keeps a valid image while exercising exact byte limits.
export async function sizedPng(size: number) {
  const bytes = await sharp({
    create: {
      width: 120,
      height: 80,
      channels: 4,
      background: { r: 60, g: 120, b: 180, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
  return Buffer.concat([bytes, Buffer.alloc(Math.max(0, size - bytes.length))]);
}

export function imageData(bytes: Buffer, mime = "image/png") {
  return `data:${mime};base64,${bytes.toString("base64")}`;
}
