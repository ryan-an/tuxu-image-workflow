import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import sharp from "sharp";
import { fixture, password } from "../support/production.js";
import { artifactPath } from "../support/artifacts.cjs";

test(
  "workbench loads nearby thumbnails and requests originals only in the full-size viewer",
  { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 60000 },
  async () => {
    const { chromium } = createRequire(import.meta.url)(
      process.env.PLAYWRIGHT_MODULE!,
    );
    const f = await fixture(resolve("dist"));
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH,
    });
    try {
      const product = structuredClone(f.product);
      const sources: string[] = [];
      for (let index = 0; index < product.tasks.length * 2; index++) {
        const bytes = await sharp({
          create: {
            width: 1600,
            height: 1600,
            channels: 3,
            background: { r: 50 + index * 5, g: 100, b: 180 },
          },
        })
          .png()
          .toBuffer();
        sources.push(await f.workflows.assets.put(bytes, "image/png"));
      }
      product.photo = sources[0];
      product.photos = [sources[0]];
      product.tasks.forEach((task, index) => {
        task.references = [sources[index * 2]];
        task.versions = [
          {
            id: `version-${index}`,
            number: 1,
            source: sources[index * 2 + 1],
            prompt: "test prompt",
            origin: "generated",
            createdAt: Date.now(),
          },
        ];
        task.primaryId = task.versions[0].id;
        task.selectedIds = [task.versions[0].id];
      });
      await f.workflows.repo.saveProduct(f.db, product);
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const root = `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`;
      const page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
      });
      const images: string[] = [];
      const errors: string[] = [];
      page.on("request", (request: any) => {
        if (request.resourceType() === "image")
          images.push(new URL(request.url()).pathname);
      });
      page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.goto(root);
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      const cards = page.locator(".task-card");
      await cards.first().waitFor();
      await page.waitForFunction(() => {
        const image = document.querySelector<HTMLImageElement>(
          ".task-card .result-image img",
        );
        return image?.naturalWidth && image.src.endsWith("/thumbnail");
      });
      assert.ok(images.some((path) => path.endsWith("/thumbnail")));
      assert.deepEqual(
        images.filter((path) => sources.includes(path)),
        [],
      );
      assert.equal(
        await cards.last().locator(".result-image img").getAttribute("src"),
        null,
      );
      const lastSource = sources.at(-1)!;
      assert.ok(!images.includes(`${lastSource}/thumbnail`));
      await page.screenshot({
        path: artifactPath("image-loading-previews.png"),
      });

      await cards.last().scrollIntoViewIfNeeded();
      await page.waitForFunction((source: string) => {
        const images = document.querySelectorAll<HTMLImageElement>(
          ".task-card .result-image img",
        );
        const last = images[images.length - 1];
        return last?.naturalWidth && last.src.endsWith(source + "/thumbnail");
      }, lastSource);
      assert.deepEqual(
        images.filter((path) => sources.includes(path)),
        [],
      );

      await cards.last().locator(".result-image").click();
      await page.waitForFunction((source: string) => {
        const image =
          document.querySelector<HTMLImageElement>(".large-preview");
        return image?.naturalWidth && image.src.endsWith(source);
      }, lastSource);
      assert.deepEqual(
        images.filter((path) => sources.includes(path)),
        [lastSource],
      );
      assert.deepEqual(errors, []);
      // Presentation changes must never overwrite stored original URLs.
      assert.equal(
        (await f.workflows.repo.view()).products[0].tasks.at(-1)!.versions[0]
          .source,
        lastSource,
      );
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
