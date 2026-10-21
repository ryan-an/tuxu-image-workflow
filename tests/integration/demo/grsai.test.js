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
  parseSuiteResponse,
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
      assert.ok(item.prompt.includes(FIXED_PRODUCT_REQUIREMENTS));
      assert.ok(
        item.prompt.includes(
          item.role.startsWith("A+") ? "970X600像素" : "1610X1610像素",
        ),
      );
    }
    const chatCalls = calls.filter((c) => c.url.endsWith("/api/v3/responses"));
    assert.equal(chatCalls.length, 1);
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

test("all editable analysis rules are respected and no old fixed rules are injected", () => {
  const product = newProduct(
    "test",
    "25 个装信封",
    "24 cm x 28 cm\n品牌：Blcculi",
  );
  const common = DEFAULT_COMMON.replace(
    FIXED_PRODUCT_REQUIREMENTS,
    "按当前实拍图生成，不添加标识。图中的文字字数控制在10-20词以内。",
  )
    .replace("1610X1610", "2000X2000")
    .replace("970X600", "1200X800")
    .replaceAll("分辨率300", "分辨率150");
  const fixture = suiteFixture();
  for (const item of fixture.images)
    item.copy = [
      "Thoughtful Design For Your Everyday Packing With Simple And Clear Details",
    ];
  const freeRules = common.replace(
    "尺寸图里面必须包含我提供的产品尺寸和数量；A+(1)里面必须包含我提供的品牌。",
    "尺寸图和A+1自由安排文案。",
  );
  const result = parseSuiteResponse(
    JSON.stringify(fixture),
    1,
    product,
    freeRules,
  );
  assert.equal(result.prompts.length, 10);
  assert.ok(result.prompts[0].prompt.includes("2000X2000像素"));
  assert.ok(result.prompts[6].prompt.includes("1200X800像素"));
  assert.ok(
    result.prompts.every(
      (p) =>
        p.prompt.includes("分辨率150") &&
        p.prompt.includes("10-20词") &&
        !p.prompt.includes(FIXED_PRODUCT_REQUIREMENTS),
    ),
  );
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
