import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { fixture, loginHeaders } from "../../support/production.js";

test("a running server serves new build assets as modules and never substitutes HTML for missing files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tuxu-static-"));
  await mkdir(join(directory, "assets"));
  const index = (version: string) =>
    `<!doctype html><html><script type="module" src="/assets/${version}.js"></script></html>`;
  await writeFile(join(directory, "index.html"), index("before"));
  await writeFile(
    join(directory, "assets", "before.js"),
    "export const version = 'before';",
  );
  const f = await fixture(directory);
  try {
    await f.app.ready();
    const before = await f.app.inject("/assets/before.js");
    assert.equal(before.statusCode, 200);
    assert.match(String(before.headers["content-type"]), /javascript/);

    for (const [extension, source] of [
      [
        "js",
        "export const message = 'compressible build asset';\n".repeat(100),
      ],
      ["css", ".example { color: rebeccapurple; }\n".repeat(100)],
    ]) {
      const filename = `module-aB12cD34.${extension}`;
      await writeFile(join(directory, "assets", filename), source);
      for (const encoding of ["gzip", "br"]) {
        const response = await f.app.inject({
          url: `/assets/${filename}`,
          headers: { "accept-encoding": encoding },
        });
        assert.equal(response.statusCode, 200);
        assert.equal(response.headers["content-encoding"], encoding);
        assert.match(String(response.headers.vary), /Accept-Encoding/i);
        assert.equal(
          response.headers["cache-control"],
          "public, max-age=31536000, immutable",
        );
        assert.equal(
          (encoding === "br" ? brotliDecompressSync : gunzipSync)(
            response.rawPayload,
          ).toString(),
          source,
        );
      }
    }

    // Introduce a new build after route registration, exactly as a local rebuild does.
    await writeFile(
      join(directory, "assets", "after.js"),
      "export const version = 'after';",
    );
    await writeFile(
      join(directory, "assets", "after.css"),
      "body { color: red; }",
    );
    await writeFile(join(directory, "index.html"), index("after"));
    for (const url of ["/assets/after.js", "/assets/after.js?v=2"]) {
      const module = await f.app.inject(url);
      assert.equal(module.statusCode, 200);
      assert.match(String(module.headers["content-type"]), /javascript/);
      assert.equal(module.body, "export const version = 'after';");
    }
    const css = await f.app.inject("/assets/after.css");
    assert.equal(css.statusCode, 200);
    assert.match(String(css.headers["content-type"]), /text\/css/);
    const head = await f.app.inject({
      method: "HEAD",
      url: "/assets/after.js",
    });
    assert.equal(head.statusCode, 200);
    assert.match(String(head.headers["content-type"]), /javascript/);

    for (const url of ["/", "/login", "/login?next=workspace", "/index.html"]) {
      const page = await f.app.inject(url);
      assert.equal(page.statusCode, 200);
      assert.match(String(page.headers["content-type"]), /text\/html/);
      assert.equal(page.headers["cache-control"], "no-store");
      assert.match(page.body, /\/assets\/after.js/);
    }
    for (const url of [
      "/assets/missing.js",
      "/assets/missing.css",
      "/assets/no-extension",
      "/src/app.tsx",
      "/favicon.ico",
      "/assets/missing.js?version=old",
    ]) {
      const response = await f.app.inject(url);
      assert.equal(response.statusCode, 404);
      assert.doesNotMatch(
        String(response.headers["content-type"]),
        /text\/html/,
      );
      assert.ok(!response.body.includes("<!doctype"));
    }
    // API protection still takes precedence over the wildcard static route.
    assert.equal((await f.app.inject("/api/workspace")).statusCode, 401);
    assert.equal(
      (
        await f.app.inject({
          url: "/api/workspace",
          headers: await loginHeaders(f.app),
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await f.app.inject({ method: "POST", url: "/login", payload: {} }))
        .statusCode,
      404,
    );
    assert.equal((await f.app.inject("/assets/before.js")).statusCode, 200);
  } finally {
    await f.close();
    if (
      dirname(resolve(directory)) !== resolve(tmpdir()) ||
      !basename(directory).startsWith("tuxu-static-")
    )
      throw new Error("拒绝清理非测试目录");
    await rm(directory, { recursive: true, force: true });
  }
});
