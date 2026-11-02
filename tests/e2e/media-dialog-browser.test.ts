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
      assert.match(
        await page.locator("#product-photo-hint").innerText(),
        /实拍区禁止上传参考图／对标图.*没有产品实拍图可留空/,
      );

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
              viewportWidth: innerWidth,
              viewportHeight: innerHeight,
              dialogHeight: dialog.clientHeight,
              dialogScrollHeight: dialog.scrollHeight,
              galleryHeight: gallery.clientHeight,
              warningHeight:
                dialog
                  .querySelector("#media-photo-hint")
                  ?.getBoundingClientRect().height || 0,
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
        if (layout.outerScroll)
          await page.screenshot({
            path: artifactPath(
              `media-layout-overflow-${layout.viewportWidth}-${layout.viewportHeight}.png`,
            ),
          });
        assert.equal(layout.outerScroll, false, JSON.stringify(layout));
        assert.equal(layout.galleryScroll, true);
        assert.ok(layout.galleryHeight > 0, JSON.stringify(layout));
      };

      for (const action of ["manage-photos", "manage-references"]) {
        await page.locator(`[data-action="${action}"]`).first().click();
        assert.equal(
          await page.locator("#media-photo-hint").count(),
          action === "manage-photos" ? 1 : 0,
        );
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

test(
  "real photos may be left empty and their warning stays visible on desktop and mobile before generating from card references",
  { skip: !process.env.PLAYWRIGHT_MODULE, timeout: 30000 },
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
      const product = (await f.workflows.repo.view()).products[0];
      product.photo = "";
      product.photos = [];
      product.tasks[0].prompt = "使用当前卡片参考图设计";
      await f.workflows.repo.saveProduct(f.db, product);
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.goto(
        `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`,
      );
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      await page.locator("#product-photo-hint").waitFor();
      for (const viewport of [
        { width: 1440, height: 1000 },
        { width: 375, height: 667 },
      ]) {
        await page.setViewportSize(viewport);
        const hint = page.locator("#product-photo-hint");
        assert.equal(await hint.isVisible(), true);
        const hintStyle = await hint.evaluate((node: HTMLElement) => ({
          color: getComputedStyle(node).color,
          fontSize: getComputedStyle(node).fontSize,
        }));
        assert.equal(hintStyle.color, "rgb(148, 91, 6)");
        assert.equal(hintStyle.fontSize, "12px");
        const hintLayout = await hint.evaluate((node: HTMLElement) => {
          const hint = node.getBoundingClientRect(),
            setup = document
              .querySelector(".product-setup")!
              .getBoundingClientRect(),
            toolbar = document
              .querySelector(".task-toolbar")!
              .getBoundingClientRect();
          return {
            afterSetup: hint.top >= setup.bottom,
            beforeToolbar: hint.bottom <= toolbar.top,
            leftOffset: Math.abs(hint.left - setup.left),
            rightOffset: Math.abs(hint.right - setup.right),
          };
        });
        assert.equal(hintLayout.afterSetup, true);
        assert.equal(hintLayout.beforeToolbar, true);
        assert.ok(
          hintLayout.leftOffset < 1 && hintLayout.rightOffset < 1,
          JSON.stringify(hintLayout),
        );
        assert.equal(
          await hint.evaluate(
            (node: HTMLElement) => node.scrollWidth <= node.clientWidth,
          ),
          true,
        );
        await page.screenshot({
          path: artifactPath(
            `optional-real-photos-workspace-${viewport.width}.png`,
          ),
        });
        await page.locator('[data-action="manage-photos"]').click();
        assert.equal(await page.locator("#media-photo-hint").isVisible(), true);
        assert.equal(await page.locator(".media-gallery img").count(), 0);
        await page
          .getByText("没有产品实拍图就留空，请勿用参考图代替。", {
            exact: true,
          })
          .waitFor();
        assert.match(
          await page.locator("#media-photo-hint").innerText(),
          /产品外观依据.*误传对标图容易让模型沿用其产品、构图和背景/s,
        );
        assert.equal(
          await page.locator("#media-upload-hint").innerText(),
          "仅上传本产品实拍照片，支持多选、拖拽和粘贴",
        );
        assert.equal(
          await page
            .locator("#modal")
            .evaluate(
              (node: HTMLElement) =>
                node.scrollWidth <= node.clientWidth &&
                node.scrollHeight <= node.clientHeight + 1,
            ),
          true,
        );
        await page.screenshot({
          path: artifactPath(
            `optional-real-photos-dialog-${viewport.width}.png`,
          ),
        });
        await page
          .locator('.media-modal-footer [data-action="close-modal"]')
          .click();
      }
      const [response] = await Promise.all([
        page.waitForResponse(
          (response: any) =>
            response.url().endsWith("/api/jobs") &&
            response.request().method() === "POST",
        ),
        page
          .locator(".task-card")
          .first()
          .getByRole("button", { name: "生成图片", exact: true })
          .click(),
      ]);
      assert.equal(response.status(), 200);
      const jobs = (await f.workflows.repo.view()).jobs;
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].referenceImageKind, "reference");
      assert.deepEqual(jobs[0].referenceImages, product.tasks[0].references);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
