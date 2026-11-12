import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { fixture } from "../../support/production.js";
import {
  GrsaiProvider,
  ProviderError,
} from "../../../server/production/provider.js";
import { GENERATION_REQUEST_LIMIT } from "../../../server/production/generation-request.js";

const config = { imageModel: "gpt-image-2", gptSize: "auto", quality: "auto" };

test("multiple individually small photos fit the actual Base64 JSON budget without dropping images or changing stored originals", async (t) => {
  const f = await fixture();
  try {
    const sources: string[] = [],
      originals: Buffer[] = [];
    for (const background of ["#ff000080", "#00ff0080", "#0000ff80"]) {
      const bytes = await sharp({
        create: { width: 1100, height: 800, channels: 4, background },
      })
        .png({ compressionLevel: 0 })
        .toBuffer();
      assert.ok(bytes.length < 6_000_000);
      originals.push(bytes);
      sources.push(await f.workflows.assets.put(bytes, "image/png"));
    }
    let sent = "";
    t.mock.method(
      globalThis,
      "fetch",
      async (_url: unknown, init?: { body?: unknown }) => {
        sent = String(init?.body);
        return Response.json({ id: "task-compact" });
      },
    );
    const diagnostics: Record<string, any>[] = [];
    const provider = new GrsaiProvider(f.workflows.assets, (event) =>
      diagnostics.push(event),
    );
    const prompt = "中文产品细节 🧶，完整保留每张附图。";
    const result = await provider.submit(
      prompt,
      sources,
      config,
      "private-key",
      new AbortController().signal,
    );
    assert.equal(result.id, "task-compact");
    assert.ok(Buffer.byteLength(sent) < GENERATION_REQUEST_LIMIT);
    const body = JSON.parse(sent);
    assert.equal(body.prompt, prompt);
    assert.equal(body.images.length, sources.length);
    for (const [index, source] of sources.entries()) {
      assert.deepEqual(
        (await f.workflows.assets.get(source.split("/").at(-1)!)).bytes,
        originals[index],
      );
      const bytes = Buffer.from(body.images[index].split(",")[1], "base64");
      const { data, info } = await sharp(bytes)
        .raw()
        .toBuffer({ resolveWithObject: true });
      assert.equal(info.width, 1100);
      assert.equal(info.height, 800);
      assert.equal(info.channels, 4);
      assert.ok(data[index] > 240, `image ${index} stays in order`);
      assert.ok(Math.abs(data[3] - 128) <= 1);
    }
    const request = diagnostics.find(
      (event) => event.event === "platform.request",
    )!;
    assert.equal(request.bodyBytes, Buffer.byteLength(sent));
    assert.equal(request.imageCount, 3);
    assert.ok(!JSON.stringify(diagnostics).includes(prompt));
    assert.ok(!JSON.stringify(diagnostics).includes("private-key"));
  } finally {
    await f.close();
  }
});

test("old oversized assets are prepared on submission while small images and URL references stay unchanged", async (t) => {
  const f = await fixture();
  try {
    const bytes = await sharp({
      create: {
        width: 1800,
        height: 1100,
        channels: 4,
        background: "#4488cc80",
      },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    assert.ok(bytes.length > 6 * 1024 * 1024);
    const source = await f.workflows.assets.put(bytes, "image/png");
    const small = await f.workflows.assets.providerSource(f.product.photo);
    let body: any;
    t.mock.method(
      globalThis,
      "fetch",
      async (_url: unknown, init?: { body?: unknown }) => {
        body = JSON.parse(String(init?.body));
        return Response.json({ id: "task-old" });
      },
    );
    await new GrsaiProvider(f.workflows.assets).submit(
      "prompt",
      [f.product.photo, source, "https://example.com/reference.png"],
      config,
      "key",
      new AbortController().signal,
    );
    assert.equal(body.images[0], small);
    assert.equal(body.images[2], "https://example.com/reference.png");
    assert.ok(
      Buffer.byteLength(JSON.stringify(body)) < GENERATION_REQUEST_LIMIT,
    );
    assert.deepEqual(
      (await f.workflows.assets.get(source.split("/").at(-1)!)).bytes,
      bytes,
    );
  } finally {
    await f.close();
  }
});

test("HTTP 413 with an HTML response becomes readable Chinese, stays definitive and never resubmits automatically", async (t) => {
  const f = await fixture();
  try {
    const fetch = t.mock.method(
      globalThis,
      "fetch",
      async () =>
        new Response("<html>Request Entity Too Large private proxy</html>", {
          status: 413,
          headers: { "content-type": "text/html", "x-request-id": "too-large" },
        }),
    );
    await assert.rejects(
      new GrsaiProvider(f.workflows.assets).submit(
        "prompt",
        [f.product.photo],
        config,
        "secret",
        new AbortController().signal,
      ),
      (error: any) => {
        assert.ok(error instanceof ProviderError);
        assert.match(error.message, /提交的数据总量超过服务限制/);
        assert.match(error.message, /HTTP 413.*too-large/);
        assert.doesNotMatch(error.message, /<html>|private proxy|secret/);
        assert.equal(error.definitive, true);
        assert.equal(error.retryable, false);
        return true;
      },
    );
    assert.equal(fetch.mock.callCount(), 1);
  } finally {
    await f.close();
  }
});

test("oversized text and cancellation stop before any paid image submission", async (t) => {
  const f = await fixture();
  try {
    const fetch = t.mock.method(globalThis, "fetch", async () => {
      throw new Error("should not submit");
    });
    const provider = new GrsaiProvider(f.workflows.assets);
    await assert.rejects(
      provider.submit(
        "中".repeat(2_000_000),
        [],
        config,
        "key",
        new AbortController().signal,
      ),
      /提示词或图片链接过大/,
    );
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await assert.rejects(
      provider.submit(
        "prompt",
        [f.product.photo],
        config,
        "key",
        controller.signal,
      ),
      /cancelled/,
    );
    assert.equal(fetch.mock.callCount(), 0);
  } finally {
    await f.close();
  }
});
