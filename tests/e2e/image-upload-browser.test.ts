import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fixture, password } from "../support/production.js";
import { sizedPng } from "../support/upload-images.js";
import { UPLOAD_IMAGE_LIMIT } from "../../server/production/upload-images.js";

test(
  "file uploads compress large product photos and clipboard references at 6MB remain byte-for-byte unchanged after reload",
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
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const page = await browser.newPage();
      const errors: string[] = [];
      const saves: string[][] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      page.on("request", (request: any) => {
        if (
          request.url().endsWith("/api/workspace") &&
          request.method() === "PATCH"
        )
          saves.push(
            request
              .postDataJSON()
              .edits.map((edit: any) => edit.path.join("/")),
          );
      });
      await page.goto(
        `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`,
      );
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      await page.locator('[data-action="manage-photos"]').click();
      assert.match(
        await page.locator("#media-feedback").innerText(),
        /大于 6MB 的图片自动压缩/,
      );
      const savedPhoto = page.waitForResponse(
        (response: any) =>
          response.url().endsWith("/api/workspace") &&
          response.request().method() === "PATCH" &&
          response
            .request()
            .postDataJSON()
            .edits.some((edit: any) => edit.path.includes("photos")),
      );
      await page.setInputFiles("#image-input", {
        name: "large.png",
        mimeType: "image/png",
        buffer: await sizedPng(UPLOAD_IMAGE_LIMIT + 1),
      });
      try {
        assert.equal((await savedPhoto).status(), 200);
      } catch (error) {
        throw new Error(
          JSON.stringify({
            feedback: await page.locator("#media-feedback").innerText(),
            saves,
            errors,
          }),
          { cause: error },
        );
      }
      const photo = (await f.workflows.repo.view()).products[0].photos.at(-1)!;
      const compressed = await f.workflows.assets.get(photo.split("/").at(-1)!);
      assert.ok(compressed.bytes.length < UPLOAD_IMAGE_LIMIT);
      assert.equal(compressed.mime, "image/webp");
      await page.keyboard.press("Escape");

      await page.locator('[data-action="manage-references"]').first().click();
      const boundary = await sizedPng(UPLOAD_IMAGE_LIMIT);
      const savedReference = page.waitForResponse(
        (response: any) =>
          response.url().endsWith("/api/workspace") &&
          response.request().method() === "PATCH" &&
          response
            .request()
            .postDataJSON()
            .edits.some((edit: any) => edit.path.includes("references")),
      );
      await page.evaluate((base64: string) => {
        const transfer = new DataTransfer();
        transfer.items.add(
          new File(
            [Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))],
            "boundary.png",
            { type: "image/png" },
          ),
        );
        document.querySelector("#media-dropzone")!.dispatchEvent(
          new ClipboardEvent("paste", {
            clipboardData: transfer,
            bubbles: true,
            cancelable: true,
          }),
        );
      }, boundary.toString("base64"));
      assert.equal((await savedReference).status(), 200);
      const reference = (
        await f.workflows.repo.view()
      ).products[0].tasks[0].references.at(-1)!;
      const original = await f.workflows.assets.get(
        reference.split("/").at(-1)!,
      );
      assert.deepEqual(original.bytes, boundary);
      assert.equal(original.mime, "image/png");

      await page.reload();
      await page.locator('[data-action="manage-photos"]').click();
      await page.locator(`.media-gallery img[src="${photo}"]`).waitFor();
      await page.keyboard.press("Escape");
      await page.locator('[data-action="manage-references"]').first().click();
      await page.locator(`.media-gallery img[src="${reference}"]`).waitFor();
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
