import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  grsaiPlugin,
  generationPayload,
  DEFAULT_CONFIG,
} from "../../../server/demo/grsai.js";
import { ROLES, newProduct } from "../../../shared/model.js";
import { migrateAutoSizeDefaults } from "../../../shared/generation-settings.js";
import {
  FIXED_PRODUCT_REQUIREMENTS,
  DEFAULT_COMMON,
  LEGACY_DEFAULT_COMMON,
  parseSuiteResponse,
  generationImages,
} from "../../../shared/prompt-suite.js";
const suiteFixture = () => ({
  style:
    "主色#FFF8F3；辅色#EADFD8；强调色#A72D3F；文字#27313C。类似电商无衬线风；Inter Bold 80px/44px、Inter Regular 42px/24px、Inter Medium 32px/20px，免费商用OFL字体；细线边框及充足留白。",
  images: ROLES.map((role, i) => ({
    role,
    layout: "重新安排产品位置、图标与英文标题，不照搬对标布局。",
    copy: [
      i === 0
        ? "25 Pack 24 cm x 28 cm Outer Size"
        : i === 6
          ? "Blcculi Made For Your Everyday Packing"
          : "Thoughtful Design For Your Everyday Packing",
    ],
    thirdPart: "AI 返回的产品约束：保持产品结构，使用少量英文文案。",
    fourthPart: `AI 返回的画布：${i < 6 ? "1400X1000" : "1100X650"}像素，分辨率150。`,
    photoIndices: [0],
  })),
});
test("nano and GPT use their documented parameters", () => {
  const nano = generationPayload(DEFAULT_CONFIG, {
    prompt: "test",
    referenceImages: ["data:image/png;base64,abc"],
  });
  assert.ok(!("imageSize" in nano));
  assert.equal(nano.aspectRatio, "auto");
  const manual = generationPayload(
    { ...DEFAULT_CONFIG, aspectRatio: "16:9", imageSize: "2K" },
    { prompt: "test" },
  );
  assert.equal(manual.imageSize, "2K");
  assert.equal(manual.aspectRatio, "16:9");
  assert.ok(!("imageSize" in generationPayload({}, { prompt: "test" })));
  assert.equal(
    generationPayload(
      { ...DEFAULT_CONFIG, imageModel: "gpt-image-2" },
      { prompt: "test" },
    ).aspectRatio,
    "auto",
  );
  assert.deepEqual(
    migrateAutoSizeDefaults({
      aspectRatio: "1:1",
      imageSize: "1K",
      gptSize: "1024x1024",
    }),
    { aspectRatio: "auto", imageSize: "auto", gptSize: "auto" },
  );
  assert.deepEqual(
    migrateAutoSizeDefaults({
      aspectRatio: "16:9",
      imageSize: "4K",
      gptSize: "2048x2048",
    }),
    { aspectRatio: "16:9", imageSize: "4K", gptSize: "2048x2048" },
  );
  assert.equal(nano.replyType, "async");
  assert.ok(!("quality" in nano));
  const gpt = generationPayload(
    { ...DEFAULT_CONFIG, imageModel: "gpt-image-2", gptSize: "1024x1024" },
    { prompt: "test" },
  );
  assert.equal(gpt.quality, "auto");
  assert.equal(gpt.aspectRatio, "1024x1024");
  assert.ok(!("imageSize" in gpt));
  assert.throws(
    () =>
      generationPayload(
        { ...DEFAULT_CONFIG, imageModel: "gpt-image-2-vip", quality: "auto" },
        { prompt: "test" },
      ),
    /不支持/,
  );
  assert.throws(
    () =>
      generationPayload(
        {
          ...DEFAULT_CONFIG,
          imageModel: "gpt-image-2-vip",
          quality: "medium",
          gptSize: "4000x4000",
        },
        { prompt: "test" },
      ),
    /约束/,
  );
});
test("local adapter submits, polls, preserves IDs and hides the API key", async () => {
  let middleware;
  grsaiPlugin().configureServer({
    middlewares: {
      use(fn) {
        middleware = fn;
      },
    },
  });
  const server = http.createServer(
    (req, res) =>
      void middleware(req, res, () => {
        res.statusCode = 404;
        res.end();
      }),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const root = `http://127.0.0.1:${server.address().port}`;
  const original = globalThis.fetch,
    calls = [];
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(url);
    if (parsed.hostname === "127.0.0.1") return original(url, options);
    calls.push({ url: String(url), options });
    if (parsed.pathname === "/v1/api/generate")
      return Response.json({ id: "remote-123", status: "running" });
    if (parsed.pathname === "/v1/api/result")
      return Response.json({
        id: "remote-123",
        status: "succeeded",
        results: [{ url: "https://file1.aitohumanize.com/test.png" }],
      });
    if (parsed.pathname === "/test.png")
      return new Response(Buffer.from("aGVsbG8=", "base64"), {
        headers: { "Content-Type": "image/png" },
      });
    if (parsed.pathname === "/api/v3/responses")
      return Response.json({
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              { type: "output_text", text: JSON.stringify(suiteFixture()) },
            ],
          },
        ],
      });
    throw new Error("Unexpected request");
  };
  try {
    const post = (path, data) =>
      fetch(root + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).then((r) => r.json());
    const config = await post("/api/workflow/settings", {
      ...DEFAULT_CONFIG,
      mode: "live",
      apiKey: "fake-key-for-test",
      promptApiKey: "fake-doubao-for-test",
    });
    assert.equal(config.hasKey, true);
    assert.equal(config.hasPromptKey, true);
    assert.ok(!("apiKey" in config));
    assert.ok(!("promptApiKey" in config));
    const job = await post("/api/workflow/image", {
      prompt: "product prompt",
      referenceImages: ["data:image/png;base64,abc"],
    });
    assert.equal(job.id, "remote-123");
    const result = await post("/api/workflow/result", { id: job.id });
    assert.equal(result.status, "succeeded");
    assert.ok(result.image.startsWith("data:image/png;base64,"));
    const product = newProduct(
      "test",
      "25 个装金属亮面红色气泡信封",
      "外尺寸：宽度24 cm x 高28 cm\n品牌：Blcculi",
    );
    product.photo = "data:image/png;base64,actual-photo";
    product.tasks.forEach(
      (task, i) =>
        (task.references = [`data:image/png;base64,competitor-${i}`]),
    );
    const prompt = await post("/api/workflow/prompt-set", {
      product,
      common: DEFAULT_COMMON,
    });
    assert.equal(prompt.prompts.length, 10);
    for (const item of prompt.prompts) {
      assert.ok(item.prompt.includes("AI 返回的产品约束"));
      assert.ok(!item.prompt.includes(FIXED_PRODUCT_REQUIREMENTS));
      assert.ok(
        item.prompt.includes(
          item.role.startsWith("A+") ? "1100X650像素" : "1400X1000像素",
        ),
      );
    }
    product.photo = "";
    const withoutPhotos = await post("/api/workflow/prompt-set", {
      product,
      common: DEFAULT_COMMON,
    });
    assert.equal(withoutPhotos.prompts.length, 10);
    assert.ok(withoutPhotos.prompts.every((item) => !item.photoIndices.length));
    const withoutPhotosVision = JSON.parse(
      calls.filter((call) => call.url.endsWith("/api/v3/responses")).at(-1)
        .options.body,
    ).input[0].content;
    assert.ok(withoutPhotosVision[0].text.includes("本次没有产品实拍图"));
    assert.ok(
      !withoutPhotosVision.some((item) => item.text?.startsWith("产品实拍图 ")),
    );
    const referenceInput = generationImages(product, product.tasks[1]);
    await post("/api/workflow/image", {
      prompt: "reference prompt",
      ...referenceInput,
    });
    const referenceRequest = JSON.parse(
      calls.filter((call) => call.url.endsWith("/generate")).at(-1).options
        .body,
    );
    assert.deepEqual(referenceRequest.images, referenceInput.referenceImages);
    assert.equal(referenceRequest.images.length, 10);
    assert.ok(
      referenceRequest.prompt.includes("当前要做的对标图：图片 2（卖点图）"),
    );
    const chatCalls = calls.filter((c) => c.url.endsWith("/api/v3/responses"));
    assert.equal(chatCalls.length, 2);
    assert.equal(
      chatCalls[0].options.headers.Authorization,
      "Bearer fake-doubao-for-test",
    );
    const vision = JSON.parse(chatCalls[0].options.body).input[0].content;
    assert.equal(
      vision.filter((item) => item.type === "input_image").length,
      11,
    );
    for (const role of ROLES)
      assert.ok(
        vision.some(
          (item) =>
            item.type === "input_text" &&
            item.text.includes(`对标图片位置：${role}`),
        ),
      );
    product.photo = "data:image/png;base64,actual-photo";
    for (const allMissing of [false, true]) {
      product.tasks.forEach((task, index) => {
        if (allMissing || index > 0) task.references = [];
      });
      const optional = await post("/api/workflow/prompt-set", {
        product,
        common: DEFAULT_COMMON,
      });
      assert.equal(optional.prompts.length, 10);
      const optionalVision = JSON.parse(
        calls.filter((call) => call.url.endsWith("/api/v3/responses")).at(-1)
          .options.body,
      ).input[0].content;
      assert.equal(
        optionalVision.filter((item) => item.type === "input_image").length,
        allMissing ? 1 : 2,
      );
      assert.ok(
        optionalVision.some((item) =>
          item.text?.includes("未提供对标图，请依据产品资料"),
        ),
      );
    }
    const request = JSON.parse(
      calls.find((c) => c.url.endsWith("/generate")).options.body,
    );
    assert.deepEqual(request.images, ["data:image/png;base64,abc"]);
    assert.equal(request.replyType, "async");
    assert.ok(calls.some((c) => c.url.includes("/result?id=remote-123")));
    await post("/api/workflow/settings", {
      imageModel: "gpt-image-2",
      quality: "auto",
    });
    await post("/api/workflow/image", { prompt: "gpt test" });
    const gpt = JSON.parse(
      calls.filter((c) => c.url.endsWith("/generate")).at(-1).options.body,
    );
    assert.equal(gpt.model, "gpt-image-2");
    assert.equal(gpt.quality, "auto");
  } finally {
    globalThis.fetch = original;
    await new Promise((resolve) => server.close(resolve));
  }
});
test("suite contract checks structure without checking copy content", () => {
  const product = newProduct(
    "test",
    "25 个装信封",
    "24 cm x 28 cm\n品牌：Blcculi",
  );
  const fixture = suiteFixture();
  fixture.images[0].copy = ["短文案"];
  fixture.images[6].copy = [
    "one two three four five six seven eight nine ten eleven",
  ];
  const result = parseSuiteResponse(JSON.stringify(fixture), 1, product);
  assert.equal(result.prompts.length, 10);
  assert.equal(result.warnings, undefined);
  fixture.images.pop();
  assert.throws(() => parseSuiteResponse(JSON.stringify(fixture)), /完整10张/);
});

test("default, legacy and custom templates never replace any model-returned section", () => {
  const product = newProduct(
    "test",
    "25 个装信封",
    "24 cm x 28 cm\n品牌：Blcculi",
  );
  const fixture = suiteFixture();
  for (const common of [
    DEFAULT_COMMON,
    LEGACY_DEFAULT_COMMON.replace(/\n/g, "\r\n"),
    "自定义模板原文：不得作为 AI 返回内容的兜底。第四部分：2000X2000。",
  ]) {
    const result = parseSuiteResponse(
      JSON.stringify(fixture),
      1,
      product,
      common,
    );
    assert.equal(result.prompts.length, 10);
    for (const [index, item] of fixture.images.entries()) {
      const prompt = result.prompts[index].prompt;
      for (const text of [
        item.layout,
        ...item.copy,
        fixture.style,
        item.thirdPart,
        item.fourthPart,
      ])
        assert.ok(prompt.includes(text));
      assert.ok(!prompt.includes(FIXED_PRODUCT_REQUIREMENTS));
      assert.doesNotMatch(prompt, /1610X1610|970X600|2000X2000|分辨率300/);
    }
    const missing = structuredClone(fixture);
    delete missing.images[0].thirdPart;
    delete missing.images[0].fourthPart;
    const prompt = parseSuiteResponse(
      JSON.stringify(missing),
      1,
      product,
      common,
    ).prompts[0].prompt;
    assert.ok(!prompt.includes(common));
    assert.ok(!prompt.includes(FIXED_PRODUCT_REQUIREMENTS));
    assert.doesNotMatch(prompt, /1610X1610|分辨率300|2000X2000/);
  }
});
test("API key survives development module reloads but is never returned", async () => {
  let middleware;
  const install = () =>
    grsaiPlugin().configureServer({
      middlewares: {
        use(fn) {
          middleware = fn;
        },
      },
    });
  install();
  const server = http.createServer(
    (req, res) => void middleware(req, res, () => res.end()),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const root = `http://127.0.0.1:${server.address().port}`;
  try {
    await fetch(root + "/api/workflow/settings", {
      method: "POST",
      body: JSON.stringify({ apiKey: "reload-test-key", ...DEFAULT_CONFIG }),
    });
    install();
    const data = await fetch(root + "/api/workflow/settings").then((r) =>
      r.json(),
    );
    assert.equal(data.hasKey, true);
    assert.ok(!JSON.stringify(data).includes("reload-test-key"));
    await fetch(root + "/api/workflow/settings", {
      method: "POST",
      body: JSON.stringify({ clearKey: true }),
    });
    install();
    assert.equal(
      (await fetch(root + "/api/workflow/settings").then((r) => r.json()))
        .hasKey,
      false,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
