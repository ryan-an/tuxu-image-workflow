import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import {
  uploadedImage,
  UPLOAD_IMAGE_LIMIT,
} from "../../../server/production/upload-images.js";
import { sizedPng } from "../../support/upload-images.js";

test("uploads at or below 6MB keep the exact original bytes and MIME", async () => {
  for (const size of [512, UPLOAD_IMAGE_LIMIT - 1, UPLOAD_IMAGE_LIMIT]) {
    const bytes = await sizedPng(size);
    const result = await uploadedImage(bytes, "image/png");
    assert.equal(result.bytes, bytes);
    assert.equal(result.mime, "image/png");
  }
});

test("an upload one byte above 6MB is compressed without resizing or flattening alpha", async () => {
  const bytes = await sizedPng(UPLOAD_IMAGE_LIMIT + 1);
  const result = await uploadedImage(bytes, "image/png");
  assert.ok(result.bytes.length < UPLOAD_IMAGE_LIMIT);
  assert.equal(result.mime, "image/webp");
  const metadata = await sharp(result.bytes).metadata();
  assert.equal(metadata.width, 120);
  assert.equal(metadata.height, 80);
  assert.equal(metadata.hasAlpha, true);
  const { data } = await sharp(result.bytes)
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(data[3], 128);
});

test(
  "high entropy uploads reduce dimensions when quality alone cannot meet 6MB",
  { timeout: 60000 },
  async () => {
    const width = 3600,
      height = 3200;
    const bytes = await sharp(randomBytes(width * height * 3), {
      raw: { width, height, channels: 3 },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    assert.ok(bytes.length > UPLOAD_IMAGE_LIMIT);
    const result = await uploadedImage(bytes, "image/png");
    const metadata = await sharp(result.bytes).metadata();
    assert.ok(result.bytes.length < UPLOAD_IMAGE_LIMIT);
    assert.ok(metadata.width! < width && metadata.height! < height);
    assert.ok(
      Math.abs(metadata.width! / metadata.height! - width / height) < 0.002,
    );
  },
);

test("large rotated photos keep their displayed dimensions and animation retains frames", async () => {
  const jpeg = await sharp({
    create: { width: 120, height: 80, channels: 3, background: "red" },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const rotated = await uploadedImage(
    Buffer.concat([jpeg, Buffer.alloc(UPLOAD_IMAGE_LIMIT + 1 - jpeg.length)]),
    "image/jpeg",
  );
  const orientation = await sharp(rotated.bytes).metadata();
  assert.equal(orientation.width, 80);
  assert.equal(orientation.height, 120);
  assert.ok(!orientation.orientation || orientation.orientation === 1);

  const frames = Buffer.concat([
    Buffer.from(
      Array(16 * 16)
        .fill([255, 0, 0, 128])
        .flat(),
    ),
    Buffer.from(
      Array(16 * 16)
        .fill([0, 0, 255, 128])
        .flat(),
    ),
  ]);
  const gif = await sharp(frames, {
    raw: { width: 16, height: 32, channels: 4, pageHeight: 16 },
  })
    .gif({ delay: [100, 200], loop: 3 })
    .toBuffer();
  const animated = await uploadedImage(
    Buffer.concat([gif, Buffer.alloc(UPLOAD_IMAGE_LIMIT + 1 - gif.length)]),
    "image/gif",
  );
  const metadata = await sharp(animated.bytes, { animated: true }).metadata();
  assert.equal(metadata.pages, 2);
  assert.deepEqual(metadata.delay, [100, 200]);
  assert.equal(metadata.loop, 3);
  assert.equal(metadata.pageHeight, 16);
});

test("corrupt oversized uploads return an actionable compression error", async () => {
  await assert.rejects(
    uploadedImage(Buffer.alloc(UPLOAD_IMAGE_LIMIT + 1), "image/png"),
    /图片自动压缩失败/,
  );
});
