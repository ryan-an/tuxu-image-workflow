import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fixture, password } from "../support/production.js";
import { artifactPath } from "../support/artifacts.cjs";

test(
  "semantic badges stay readable and consistent across workbench, queue and settings",
  {
    skip: !process.env.PLAYWRIGHT_MODULE,
    timeout: 45000,
  },
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
      await f.db.transaction(async (tx) => {
        const state = await f.workflows.repo.view(tx);
        for (const [index, status] of [
          "queued",
          "running",
          "completed",
          "failed",
          "interrupted",
        ].entries()) {
          await f.workflows.repo.insertJob(tx, {
            id: randomUUID(),
            productId: f.product.id,
            taskId: f.product.tasks[index].id,
            productName: f.product.name,
            role: f.product.tasks[index].role,
            kind: "image",
            mode: "live",
            status,
            stage: status === "running" ? "polling" : "pending",
            config: state.settings,
            createdAt: Date.now() + index,
            progress: status === "running" ? 42 : 0,
            error: status === "failed" ? "测试失败提醒" : "",
          } as any);
        }
      });
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const root = `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`;
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.goto(root);
      await page.fill("#login-password", password);
      await page.click('#login-form button[type="submit"]');
      await page.locator(".task-card").first().waitFor();

      const checkBadges = async () => {
        const badges = await page
          .locator(".ui-badge:visible")
          .evaluateAll((elements: Element[]) =>
            elements.map((element) => {
              const style = getComputedStyle(element);
              function luminance(rgb: string) {
                const channels = rgb
                  .match(/[\d.]+/g)!
                  .slice(0, 3)
                  .map(Number)
                  .map((n) => {
                    const s = n / 255;
                    return s <= 0.04045
                      ? s / 12.92
                      : ((s + 0.055) / 1.055) ** 2.4;
                  });
                return (
                  channels[0] * 0.2126 +
                  channels[1] * 0.7152 +
                  channels[2] * 0.0722
                );
              }
              const fg = luminance(style.color),
                bg = luminance(style.backgroundColor);
              return {
                text: element.textContent,
                tone: element.getAttribute("data-badge-tone"),
                contrast: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05),
                size: parseFloat(style.fontSize),
                weight: style.fontWeight,
                height: element.getBoundingClientRect().height,
                color: style.color,
                background: style.backgroundColor,
                border: style.borderTopStyle,
              };
            }),
          );
        assert.ok(badges.length > 0);
        for (const badge of badges) {
          assert.ok(
            badge.contrast >= 4.5,
            `${badge.text}: contrast ${badge.contrast}`,
          );
          assert.equal(badge.size, 10, `${badge.text}: compact font`);
          assert.equal(badge.weight, "400", `${badge.text}: regular weight`);
          assert.ok(
            badge.height <= 20.01,
            `${badge.text}: compact height ${badge.height}`,
          );
          assert.equal(badge.border, "none");
        }
        return badges;
      };
      await checkBadges();
      assert.equal(
        await page
          .locator(
            ".task-card .status-badge.running .status-spinner, .task-card .status-badge.working .status-spinner",
          )
          .count(),
        1,
      );
      await page.screenshot({
        path: artifactPath("design-system-workbench.png"),
        fullPage: true,
      });
      await page.locator('[data-action="ask-doubao"]').first().click();
      await page.locator(".assistant-context-tag").first().waitFor();
      await checkBadges();
      await page.getByRole("button", { name: "收起对话", exact: true }).click();
      await page.locator('[data-action="view"][data-view="queue"]').click();
      await page.locator("#queue-tab-jobs").click();
      await page.locator(".queue-status").first().waitFor();
      const badges = await checkBadges();
      for (const tone of ["neutral", "brand", "success", "danger", "warning"]) {
        assert.ok(
          badges.some((badge: { tone: string }) => badge.tone === tone),
          `missing tone ${tone}`,
        );
      }
      await page.screenshot({
        path: artifactPath("design-system-queue.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await checkBadges();
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "mobile page must not overflow",
      );
      await page.screenshot({
        path: artifactPath("design-system-mobile.png"),
        fullPage: true,
      });
      await page.locator("#api-keys-button").click();
      await page.locator(".api-key-status").first().waitFor();
      await checkBadges();
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
