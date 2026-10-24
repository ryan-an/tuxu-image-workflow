import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import sharp from "sharp";
import { fixture, password, png } from "../support/production.js";
import { artifactPath } from "../support/artifacts.cjs";

test(
  "photo and reference dialogs prioritize large images and scroll within the gallery",
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
      const sources = [];
      for (let index = 0; index < 8; index++) {
        const width = index % 2 ? 480 : 640;
        const height = index % 2 ? 640 : 480;
        const image = await sharp(
          Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
              <rect width="100%" height="100%" fill="${index % 2 ? "#e1eadf" : "#f0e9da"}"/>
              <rect x="80" y="100" width="${width - 160}" height="${height - 200}" rx="20" fill="#6f8879"/>
              <text x="40" y="60" font-size="24" fill="#304439">REFERENCE ${index + 1}</text>
            </svg>`,
          ),
        )
          .png()
          .toBuffer();
        sources.push(
          await f.workflows.assets.normalize(
            `data:image/png;base64,${image.toString("base64")}`,
          ),
        );
      }
      const product = (await f.workflows.repo.view()).products[0];
      product.photo = sources[0];
      product.photos = sources;
      product.tasks[0].references = sources;
      await f.workflows.repo.saveProduct(f.db, product);
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      await page.goto(
        `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`,
      );
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      await page.locator(".task-card").first().waitFor();

      const checkLayout = async (desktop: boolean) => {
        const layout = await page
          .locator("#modal")
          .evaluate((dialog: HTMLElement) => {
            const gallery =
              dialog.querySelector<HTMLElement>(".media-gallery")!;
            const image = gallery.querySelector("img")!;
            const drop = dialog.querySelector("#media-dropzone")!;
            const footer = dialog.querySelector(".media-modal-footer")!;
            return {
              width: image.getBoundingClientRect().width,
              height: image.getBoundingClientRect().height,
              fit: getComputedStyle(image).objectFit,
              uploadHeight: drop.getBoundingClientRect().height,
              bottom: footer.getBoundingClientRect().bottom,
              top: dialog.getBoundingClientRect().top,
              viewportHeight: innerHeight,
              overflow: dialog.scrollWidth > dialog.clientWidth,
              outerScroll: dialog.scrollHeight > dialog.clientHeight + 1,
              galleryScroll: gallery.scrollHeight > gallery.clientHeight,
            };
          });
        assert.ok(layout.width >= 220, JSON.stringify(layout));
        assert.ok(Math.abs(layout.height - layout.width) < 1);
        assert.equal(layout.fit, "contain");
        assert.ok(layout.uploadHeight < (desktop ? 100 : 130));
        assert.ok(layout.top >= 0 && layout.bottom <= layout.viewportHeight);
        assert.equal(layout.overflow, false);
        assert.equal(layout.outerScroll, false);
        assert.equal(layout.galleryScroll, true);
      };

      for (const action of ["manage-photos", "manage-references"]) {
        await page.locator(`[data-action="${action}"]`).first().click();
        assert.equal(await page.locator(".media-gallery img").count(), 8);
        await checkLayout(true);
        await page.screenshot({
          path: artifactPath(`${action}-large-gallery.png`),
        });
        for (const viewport of [
          { width: 375, height: 667 },
          { width: 320, height: 568 },
          { width: 932, height: 430 },
        ]) {
          await page.setViewportSize(viewport);
          await checkLayout(false);
          await page
            .locator(".media-gallery")
            .evaluate((gallery: HTMLElement) => {
              gallery.scrollTop = gallery.scrollHeight;
            });
          assert.ok(
            await page
              .locator(".media-gallery")
              .evaluate((gallery: HTMLElement) => gallery.scrollTop > 0),
          );
        }
        await page.setViewportSize({ width: 375, height: 667 });
        await page.screenshot({
          path: artifactPath(`${action}-mobile-gallery.png`),
        });
        await page
          .locator('.media-modal-footer [data-action="close-modal"]')
          .click();
        await page.setViewportSize({ width: 1440, height: 1000 });
      }

      await page.locator('[data-action="manage-photos"]').click();
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser"),
        page.press("#media-dropzone", "Enter"),
      ]);
      await chooser.setFiles({
        name: "new-photo.png",
        mimeType: "image/png",
        buffer: Buffer.from(png.split(",")[1], "base64"),
      });
      await page.waitForFunction(
        () => document.querySelectorAll(".media-gallery img").length === 9,
      );
      await page
        .locator('[data-action="remove-photo"][data-index="8"]')
        .click();
      await page.waitForFunction(
        () => document.querySelectorAll(".media-gallery img").length === 8,
      );
      await page.keyboard.press("Escape");
      assert.equal(
        await page
          .locator("#modal")
          .evaluate((dialog: HTMLDialogElement) => dialog.open),
        false,
      );
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
