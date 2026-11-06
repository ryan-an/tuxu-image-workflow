import test from "node:test";
import assert from "node:assert/strict";
import { newProduct } from "../../../shared/model.js";
import {
  generationImages,
  suiteInstruction,
} from "../../../shared/prompt-suite.js";
import { generationPayload } from "../../../shared/provider-config.js";

test("reference-only generation deduplicates the full suite and identifies every current reference by upload number", () => {
  const product = newProduct("references");
  product.tasks[0].references = ["size", "shared"];
  product.tasks[1].references = ["selling", "shared", "selling"];
  product.tasks[9].references = ["last"];
  const prompt = "用户保存的四部分提示词";
  const inputs = generationImages(product, product.tasks[1]);
  const request = generationPayload({}, { prompt, ...inputs });

  assert.deepEqual(request.images, ["size", "shared", "selling", "last"]);
  assert.match(request.prompt, /本次只生成「卖点图」一张图片/);
  assert.match(request.prompt, /尺寸图：图片 1、图片 2/);
  assert.match(request.prompt, /卖点图：图片 3、图片 2/);
  assert.match(request.prompt, /A\+ 4：图片 4/);
  assert.match(request.prompt, /当前要做的对标图：图片 3、图片 2（卖点图）/);
  assert.match(request.prompt, /其他位置的对标图仅用于参考/);
  assert.match(request.prompt, /参考图／对标图，不是产品实拍图/);
  assert.ok(request.prompt.endsWith(`\n\n${prompt}`));
  assert.deepEqual(product.tasks[1].references, [
    "selling",
    "shared",
    "selling",
  ]);
});

test("a card without its own reference uses the suite without claiming another card's image as its target", () => {
  const product = newProduct("missing-current");
  product.tasks[0].references = ["size"];
  product.tasks[9].references = ["last"];
  const request = generationPayload(
    {},
    {
      prompt: "细节提示词",
      ...generationImages(product, product.tasks[2]),
    },
  );

  assert.deepEqual(request.images, ["size", "last"]);
  assert.match(request.prompt, /本次只生成「细节图」/);
  assert.match(request.prompt, /当前卡片「细节图」未提供对标图/);
  assert.doesNotMatch(request.prompt, /当前要做的对标图：/);
});

test("generation without any real photos or references remains text-only", () => {
  const product = newProduct("text-only");
  const prompt = "纯文字提示词";
  const inputs = generationImages(product, product.tasks[0]);
  const request = generationPayload({}, { prompt, ...inputs });

  assert.deepEqual(request.images, []);
  assert.equal(request.prompt, prompt);
  assert.equal(inputs.referenceImageContext, undefined);
});

test("every generation includes all real photos despite saved selections, without reference images or a count cap", () => {
  for (const { photo, photos, expected } of [
    { photo: "real-main", photos: [], expected: ["real-main"] },
    {
      photo: "",
      photos: ["real-main", "real-other"],
      expected: ["real-main", "real-other"],
    },
    {
      photo: "real-main",
      photos: ["real-other", "real-main", "", "real-third"],
      expected: ["real-main", "real-other", "real-third"],
    },
    {
      photo: "real-main",
      photos: Array.from({ length: 6 }, (_, index) => `real-${index}`),
      expected: [
        "real-main",
        ...Array.from({ length: 6 }, (_, index) => `real-${index}`),
      ],
    },
  ]) {
    const product = Object.assign(newProduct("real-photos"), { photo, photos });
    product.tasks[0].references = ["size"];
    product.tasks[1].references = ["selling"];
    const prompt = "原有生图提示词";
    for (const indices of [undefined, [], [0], [1], [99]]) {
      Object.assign(product.tasks[1], { realPhotoIndices: indices });
      const inputs = generationImages(product, product.tasks[1]);
      const request = generationPayload({}, { prompt, ...inputs });

      assert.deepEqual(request.images, expected);
      assert.equal(inputs.referenceImageKind, "product-photo");
      assert.equal(inputs.referenceImageContext, undefined);
      assert.equal(request.prompt, prompt);
      assert.deepEqual(product.photos, photos);
    }
  }
});

test("analysis instructions request all real photo indices instead of selecting viewpoints", () => {
  const product = Object.assign(newProduct("all-photos"), {
    photos: Array.from({ length: 6 }, (_, index) => `real-${index}`),
  });
  const instruction = suiteInstruction(product, "用户当前要求");
  assert.ok(instruction.includes('"photoIndices":[0,1,2,3,4,5]'));
  assert.match(instruction, /每次生图始终附带全部产品实拍图/);
});
