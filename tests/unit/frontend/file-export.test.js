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

test("selected ZIPs use fixed role numbers from 2, leave gaps and ignore card array order", async (t) => {
  const product = newProduct("FIXED-NUMBERS");
  for (const task of product.tasks)
    addVersion(task, `https://example.test/${task.role}`, "prompt");
  product.tasks[6].role = "A+(1)";
  product.tasks.reverse();
  t.mock.method(
    globalThis,
    "fetch",
    async (url) =>
      new Response(String(url), { headers: { "content-type": "image/png" } }),
  );
  let archive;
  const viewerSelections = Object.fromEntries(
    product.tasks.map((task) => [
      task.id,
      ["尺寸图", "细节图", "A+(1)", "A+ 4"].includes(task.role)
        ? task.selectedIds
        : [],
    ]),
  );
  const files = createFiles({
    state: { products: [product] },
    currentProduct: () => product,
    canEdit: false,
    ui: { downloadSelections: viewerSelections },
    notify() {},
    downloadBlob(blob) {
      archive = blob;
    },
  });
  await files.downloadSelected();
  let zip = await JSZip.loadAsync(await archive.arrayBuffer());
  assert.deepEqual(
    Object.values(zip.files)
      .filter((entry) => !entry.dir)
      .map((entry) => entry.name)
      .sort(),
    [
      "FIXED-NUMBERS/11-A+ 4-V1.png",
      "FIXED-NUMBERS/2-尺寸图-V1.png",
      "FIXED-NUMBERS/4-细节图-V1.png",
      "FIXED-NUMBERS/8-A+(1)-V1.png",
    ],
  );
  const allFiles = createFiles({
    state: { products: [product] },
    notify() {},
    downloadBlob(blob) {
      archive = blob;
    },
  });
  await allFiles.downloadSelected(true);
  zip = await JSZip.loadAsync(await archive.arrayBuffer());
  assert.deepEqual(
    Object.values(zip.files)
      .filter((entry) => !entry.dir)
      .map((entry) => entry.name.split("/")[1])
      .sort(),
    [
      "2-尺寸图-V1.png",
      "3-卖点图-V1.png",
      "4-细节图-V1.png",
      "5-场景 1-V1.png",
      "6-场景 2-V1.png",
      "7-场景 3-V1.png",
      "8-A+(1)-V1.png",
      "9-A+ 2-V1.png",
      "10-A+ 3-V1.png",
      "11-A+ 4-V1.png",
    ].sort(),
  );
});
