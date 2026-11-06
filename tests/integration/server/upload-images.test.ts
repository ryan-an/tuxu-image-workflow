import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import ExcelJS from "exceljs";
import { fixture, loginHeaders } from "../../support/production.js";
import { imageData, sizedPng } from "../../support/upload-images.js";
import { UPLOAD_IMAGE_LIMIT } from "../../../server/production/upload-images.js";
import { exportSheetTemplate } from "../../../src/integrations/sheet-template.js";

test("asset uploads compress only above 6MB and serve the stored MIME and bytes", async () => {
  const f = await fixture();
  try {
    const headers = await loginHeaders(f.app);
    for (const size of [512, UPLOAD_IMAGE_LIMIT, UPLOAD_IMAGE_LIMIT + 1]) {
      const bytes = await sizedPng(size);
      const upload = await f.app.inject({
        method: "POST",
        url: "/api/assets",
        headers,
        payload: { source: imageData(bytes) },
      });
      assert.equal(upload.statusCode, 200, upload.body);
      const response = await f.app.inject({
        url: upload.json().source,
        headers,
      });
      assert.equal(response.statusCode, 200);
      if (size <= UPLOAD_IMAGE_LIMIT) {
        assert.deepEqual(response.rawPayload, bytes);
        assert.equal(response.headers["content-type"], "image/png");
      } else {
        assert.ok(response.rawPayload.length < UPLOAD_IMAGE_LIMIT);
        assert.equal(response.headers["content-type"], "image/webp");
        const metadata = await sharp(response.rawPayload).metadata();
        assert.equal(metadata.width, 120);
        assert.equal(metadata.height, 80);
        assert.equal(metadata.hasAlpha, true);
      }
    }
    const invalid = await f.app.inject({
      method: "POST",
      url: "/api/assets",
      headers,
      payload: { source: imageData(Buffer.alloc(UPLOAD_IMAGE_LIMIT + 1)) },
    });
    assert.equal(invalid.statusCode, 400);
    assert.match(invalid.json().error, /图片格式无效/);
  } finally {
    await f.close();
  }
});

test("workspace photos and references share compressed assets while existing assets and generated results retain originals", async (t) => {
  const f = await fixture();
  try {
    const bytes = await sizedPng(UPLOAD_IMAGE_LIMIT + 1);
    const source = imageData(bytes);
    const put = t.mock.method(f.workflows.assets, "put");
    await f.workflows.edit([
      {
        path: ["products", f.product.id, "photo"],
        before: f.product.photo,
        value: source,
      },
      {
        path: ["products", f.product.id, "photos"],
        before: f.product.photos,
        value: [source],
      },
      {
        path: [
          "products",
          f.product.id,
          "tasks",
          f.product.tasks[0].id,
          "references",
        ],
        before: f.product.tasks[0].references,
        value: [source],
      },
    ]);
    assert.equal(put.mock.callCount(), 1);
    const product = (await f.workflows.repo.view()).products[0];
    assert.equal(product.photo, product.photos[0]);
    assert.equal(product.photo, product.tasks[0].references[0]);
    const uploaded = await f.workflows.assets.get(
      product.photo.split("/").at(-1)!,
    );
    assert.ok(uploaded.bytes.length < UPLOAD_IMAGE_LIMIT);
    assert.equal(uploaded.mime, "image/webp");

    const original = await f.workflows.assets.put(bytes, "image/png");
    assert.equal(await f.workflows.assets.normalize(original), original);
    const generated = await f.workflows.assets.download(
      source,
      new AbortController().signal,
    );
    assert.equal(generated, original);
    assert.deepEqual(
      (await f.workflows.assets.get(original.split("/").at(-1)!)).bytes,
      bytes,
    );
  } finally {
    await f.close();
  }
});

test("XLSX embedded photos and reference images use the same upload compression", async () => {
  const f = await fixture();
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await exportSheetTemplate());
    const sheet = workbook.worksheets[0];
    sheet.getCell("A2").value = "LARGE-IMAGE";
    const image = workbook.addImage({
      base64: imageData(await sizedPng(UPLOAD_IMAGE_LIMIT + 1)),
      extension: "png",
    });
    for (const col of [4, 14])
      sheet.addImage(image, {
        tl: { col, row: 1 },
        ext: { width: 120, height: 80 },
      });
    const headers = await loginHeaders(f.app);
    const preview = await f.app.inject({
      method: "POST",
      url: "/api/workspace/sheet-import/preview",
      headers,
      payload: {
        name: "images.xlsx",
        data: Buffer.from(await workbook.xlsx.writeBuffer()).toString("base64"),
      },
    });
    assert.equal(preview.statusCode, 200, preview.body);
    const info = preview.json();
    const confirmed = await f.app.inject({
      method: "POST",
      url: `/api/workspace/sheet-import/${info.importId}/confirm`,
      headers,
      payload: { commandId: info.commandId },
    });
    assert.equal(confirmed.statusCode, 200, confirmed.body);
    const product = (await f.workflows.repo.view()).products.find(
      (p) => p.code === "LARGE-IMAGE",
    )!;
    assert.equal(product.photo, product.tasks[0].references[0]);
    const stored = await f.workflows.assets.get(
      product.photo.split("/").at(-1)!,
    );
    assert.equal(stored.mime, "image/webp");
    assert.ok(stored.bytes.length < UPLOAD_IMAGE_LIMIT);
  } finally {
    await f.close();
  }
});
