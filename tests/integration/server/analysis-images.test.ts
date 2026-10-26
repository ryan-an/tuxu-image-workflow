import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { fixture } from "../../support/production.js";
import { AnalysisImagePool } from "../../../server/production/analysis-images.js";
import { GrsaiProvider } from "../../../server/production/provider.js";
import { demoSuite } from "../../../shared/prompt-suite.js";

test("large analysis copies are bounded and cached without changing original image bytes or generation sources", async () => {
  const f = await fixture();
  try {
    const bytes = await sharp({
      create: { width: 4000, height: 2800, channels: 3, background: "#eeeeee" },
    })
      .composite([
        {
          input: Buffer.from(
            '<svg width="4000" height="2800"><text x="120" y="300" font-family="Arial" font-size="52">OUTER 24.8 x 31.6 cm / INNER 21.4 x 28.2 cm / PACK 25</text></svg>',
          ),
        },
      ])
      .png()
      .toBuffer();
    const source = await f.workflows.assets.put(bytes, "image/png");
    const [first, second] = await Promise.all([
      f.workflows.assets.analysisSource(source),
      f.workflows.assets.analysisSource(source),
    ]);
    assert.equal(first, second);
    const result = Buffer.from(first.split(",")[1], "base64");
    const metadata = await sharp(result).metadata();
    assert.ok(metadata.width! <= 2048 && metadata.height! <= 2048);
    assert.ok(result.length <= 2 * 1024 * 1024);
    assert.deepEqual(
      (await f.workflows.assets.get(source.split("/").at(-1)!)).bytes,
      bytes,
    );
    assert.equal(
      await f.workflows.assets.providerSource(source),
      `data:image/png;base64,${bytes.toString("base64")}`,
    );
    assert.equal(await f.workflows.assets.analysisSource(source), first);
  } finally {
    await f.close();
  }
});

test("analysis deduplicates repeated images and retains every role and product-photo index", async (t) => {
  const f = await fixture();
  try {
    const state = await f.workflows.repo.view();
    const product = state.products[0];
    let body: any;
    const phases: string[] = [];
    const complete = demoSuite(product, state.common);
    const response = {
      style: complete.style,
      images: product.tasks.map((task) => ({
        role: task.role,
        layout: "test",
        copy: ["test"],
        thirdPart: "test",
        fourthPart: "test",
        photoIndices: [0],
      })),
    };
    t.mock.method(globalThis, "fetch", async (_url: any, options: any) => {
      body = JSON.parse(options.body);
      return Response.json({
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: JSON.stringify(response) }],
          },
        ],
      });
    });
    await new GrsaiProvider(f.workflows.assets).analyze(
      product,
      state.common,
      state.settings,
      "test-key",
      new AbortController().signal,
      undefined,
      async (phase) => {
        phases.push(phase.phase);
      },
    );
    const content = body.input[0].content;
    assert.equal(
      content.filter((item: any) => item.type === "input_image").length,
      1,
    );
    for (const task of product.tasks)
      assert.ok(
        content.some(
          (item: any) =>
            item.text?.includes(`对标图片位置：${task.role}`) &&
            item.text.includes("图片 1"),
        ),
      );
    assert.ok(
      content.some(
        (item: any) =>
          item.text?.includes("产品实拍图 0") && item.text.includes("图片 1"),
      ),
    );
    assert.deepEqual(phases, ["preparing", "requesting", "streaming"]);
  } finally {
    await f.close();
  }
});

test("an aborted image-preparation waiter leaves its slot available and does not run its decode", async () => {
  const pool = new AnalysisImagePool(1);
  let release!: () => void;
  const held = pool.run(
    undefined,
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const controller = new AbortController();
  const waiting = pool.run(controller.signal, async () => {
    assert.fail("aborted decode ran");
  });
  controller.abort();
  await assert.rejects(waiting);
  release();
  await held;
  assert.equal(await pool.run(undefined, async () => "available"), "available");
});
