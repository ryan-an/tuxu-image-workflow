import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { createFiles } from "../../../src/application/files.js";
import { newProduct, addVersion } from "../../../shared/model.js";

test("ZIP exports preserve all products when business codes sanitize to the same filename", async (t) => {
  const codes = [
    "SKU * 01",
    "SKU ? 01",
    "..",
    "CON",
    "SKU\n01",
    "SKU\t01",
    "SKU\r\n01",
  ];
  const products = codes.map((code) => newProduct(code));
  for (const [index, product] of products.entries())
    addVersion(
      product.tasks[0],
      `https://example.test/image-${index}`,
      "prompt",
    );
  t.mock.method(
    globalThis,
    "fetch",
    async (url) =>
      new Response(String(url), { headers: { "content-type": "image/png" } }),
  );
  let archive;
  const files = createFiles({
    state: { products },
    notify() {},
    downloadBlob(blob) {
      archive = blob;
    },
  });
  await files.downloadSelected(true);
  const zip = await JSZip.loadAsync(await archive.arrayBuffer());
  const images = Object.values(zip.files).filter((entry) => !entry.dir);
  assert.equal(images.length, products.length);
  assert.deepEqual(
    await Promise.all(images.map((entry) => entry.async("string"))),
    products.map((_, index) => `https://example.test/image-${index}`),
  );
  for (const entry of images) {
    const folder = entry.name.split("/")[0];
    assert.ok(folder && folder !== "." && folder !== "..");
    assert.doesNotMatch(folder, /[<>:"\\|?*\u0000-\u001f\u007f]/);
    assert.notEqual(folder, "CON");
  }
  assert.deepEqual(
    products.map((product) => product.code),
    codes,
  );
});
