import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import sharp from "sharp";
import { fixture, password } from "../support/production.js";
import { artifactPath } from "../support/artifacts.cjs";
import { Members } from "../../server/production/members.js";
import { WorkspaceDirectory } from "../../server/production/workspace-directory.js";
import { workflowSnapshot } from "../../shared/sheet-data.js";

test(
  "capture customer release illustrations from real workspace, membership, collaboration and history screens",
  {
    skip: !process.env.PLAYWRIGHT_MODULE,
    timeout: 90000,
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
      await f.db.query(
        "UPDATE accounts SET display_name='陈晓' WHERE id='owner'",
      );
      await f.db.query(
        "UPDATE workspace_members SET display_name='陈晓' WHERE account_id='owner'",
      );
      const directory = new WorkspaceDirectory(f.db);
      await directory.rename("owner", "default", "家居新品 · 秋季上新");
      await directory.create("owner", "户外用品 · 产品图");
      await directory.create("owner", "品牌素材 · 日常维护");
      const members = new Members(f.db);
      const editor = await members.create({
        username: "lin-mu",
        displayName: "林沐",
        role: "editor",
        monthlyLimit: null,
        password,
      });
      await members.create({
        username: "zhou-yu",
        displayName: "周予",
        role: "viewer",
        monthlyLimit: null,
        password,
      });
      const product = structuredClone(f.product);
      product.code = "HOME-026";
      product.name = "北欧陶瓷花盆";
      product.facts =
        "哑光陶瓷 · 直径 24 cm · 高 28 cm\n适用于客厅、阳台和书桌陈列";
      const image = await sharp(
        Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="900" viewBox="0 0 1000 900"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#f1eee7"/><stop offset="1" stop-color="#e0e8de"/></linearGradient><linearGradient id="pot" x2="1" y2="0"><stop stop-color="#c3ab8c"/><stop offset=".5" stop-color="#f1dec2"/><stop offset="1" stop-color="#b59b78"/></linearGradient></defs><rect width="1000" height="900" fill="url(#bg)"/><ellipse cx="505" cy="740" rx="230" ry="34" fill="#a5aa9a" opacity=".2"/><path d="M490 525C455 440 468 300 515 190M500 530C550 410 585 350 655 290M490 510C435 390 370 350 330 280" fill="none" stroke="#67765b" stroke-width="13"/><g fill="#6f8a63"><ellipse cx="475" cy="298" rx="45" ry="100" transform="rotate(-25 475 298)"/><ellipse cx="565" cy="363" rx="41" ry="95" transform="rotate(42 565 363)"/><ellipse cx="377" cy="358" rx="40" ry="95" transform="rotate(-48 377 358)"/><ellipse cx="515" cy="187" rx="39" ry="80" transform="rotate(18 515 187)"/><ellipse cx="653" cy="285" rx="36" ry="79" transform="rotate(55 653 285)"/></g><path d="M320 500H680L635 725Q500 770 365 725Z" fill="url(#pot)"/><ellipse cx="500" cy="500" rx="180" ry="35" fill="#ead9bf"/><ellipse cx="500" cy="500" rx="153" ry="20" fill="#7e6c54"/><path d="M492 515L490 477" stroke="#67765b" stroke-width="12"/><text x="500" y="840" text-anchor="middle" font-size="22" letter-spacing="5" fill="#65745f" font-family="Arial">NATURAL LIVING</text></svg>`,
        ),
      )
        .png()
        .toBuffer();
      const source = await f.workflows.assets.put(image, "image/png");
      product.photo = source;
      product.photos = [source];
      for (const task of product.tasks) {
        task.references = [source];
        task.prompt =
          "米白色背景，自然光与柔和阴影，突出哑光陶瓷质感，画面保持简洁。";
        task.versions = [
          {
            id: `release-${task.id}`,
            source,
            prompt: task.prompt,
            origin: "imported",
            number: 1,
            createdAt: Date.now(),
          },
        ];
        task.primaryId = task.versions[0].id;
        task.selectedIds = [task.versions[0].id];
      }
      await f.db.transaction(async (tx) => {
        await f.workflows.repo.saveProduct(tx, product);
        const state = await f.workflows.repo.view(tx);
        state.sheetSnapshot = workflowSnapshot(state);
        await f.workflows.repo.saveWorkspace(tx, state);
        await tx.query("DELETE FROM workspace_activity");
      });
      const actor = (await directory.context(editor.id, "default"))!;
      await f.workflows.edit(
        [
          {
            path: ["products", product.id, "facts"],
            before: product.facts,
            value: product.facts + "\n拍摄要求：保留植物的自然纹理。",
          },
        ],
        actor,
      );
      await f.workflows.edit(
        [
          {
            path: [
              "products",
              product.id,
              "tasks",
              product.tasks[0].id,
              "prompt",
            ],
            before: product.tasks[0].prompt,
            value:
              "尺寸图中清晰标注直径 24 cm、高度 28 cm，统一使用米白色背景。",
          },
        ],
        (await directory.context("owner", "default"))!,
      );
      await f.app.listen({ host: "127.0.0.1", port: 0 });
      const origin = `http://127.0.0.1:${(f.app.server.address() as { port: number }).port}`;
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      const login = async (target: any, username: string) => {
        await target.goto(origin);
        await target.fill("#login-username", username);
        await target.fill("#login-password", password);
        await target.click('#login-form button[type="submit"]');
        await target.locator(".task-card").first().waitFor();
      };
      await login(page, "admin");
      await page.waitForFunction(() =>
        [
          ...document.querySelectorAll<HTMLImageElement>(".task-card img[src]"),
        ].every((img) => img.complete && img.naturalWidth > 0),
      );
      await page.screenshot({
        path: artifactPath("release-screenshots/previews.png"),
      });
      await page
        .getByRole("button", { name: "工作区管理", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "工作区管理", exact: true })
        .waitFor();
      await page
        .getByRole("heading", { name: "户外用品 · 产品图", exact: true })
        .waitFor();
      const workspacePage = (await page
        .locator(".workspace-manager")
        .boundingBox())!;
      const lastWorkspace = (await page
        .locator(".workspace-card")
        .last()
        .boundingBox())!;
      await page.screenshot({
        path: artifactPath("release-screenshots/workspaces.png"),
        clip: {
          ...workspacePage,
          height: lastWorkspace.y + lastWorkspace.height - workspacePage.y + 24,
        },
      });
      await page.locator(".product-link").first().click();
      await page.getByRole("button", { name: "成员管理", exact: true }).click();
      await page
        .locator(".account-member")
        .filter({ hasText: "周予" })
        .waitFor();
      await page.setViewportSize({ width: 1440, height: 1400 });
      const memberPage = (await page.locator(".accounts-page").boundingBox())!;
      const lastMember = (await page
        .locator(".account-member")
        .last()
        .boundingBox())!;
      await page.screenshot({
        path: artifactPath("release-screenshots/members.png"),
        clip: {
          ...memberPage,
          height: lastMember.y + lastMember.height - memberPage.y + 12,
        },
      });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.locator(".product-link").first().click();
      await page.locator('[data-action="activity"]').click();
      const entry = page.locator(".activity-entry").last();
      await entry.locator("summary").click();
      const historyPage = (await page
        .locator(".activity-modal")
        .boundingBox())!;
      const lastEntry = (await entry.boundingBox())!;
      await page.screenshot({
        path: artifactPath("release-screenshots/history.png"),
        clip: {
          ...historyPage,
          height: lastEntry.y + lastEntry.height - historyPage.y + 24,
        },
      });
      await page.keyboard.press("Escape");
      await page.locator('[data-action="view"][data-view="sheet"]').click();
      await page.locator('.sheet-viewport[data-state="ready"]').waitFor();
      const colleagueContext = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      });
      const colleague = await colleagueContext.newPage();
      await login(colleague, "lin-mu");
      await colleague
        .locator('[data-action="view"][data-view="sheet"]')
        .click();
      await colleague.locator('.sheet-viewport[data-state="ready"]').waitFor();
      await colleague.getByText("工作流预览", { exact: true }).last().click();
      const box = colleague.locator(
        '#sheet-container [data-u-comp="defined-name"] input',
      );
      await box.fill("F3");
      await box.press("Enter");
      await page.getByText("工作流预览", { exact: true }).last().click();
      await page
        .locator(".sheet-online-user")
        .filter({ hasText: "林沐" })
        .waitFor();
      await page
        .locator(".sheet-collaborator-label")
        .filter({ hasText: "林沐" })
        .waitFor();
      await page.locator("#sheet-section").screenshot({
        path: artifactPath("release-screenshots/collaboration.png"),
      });
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await f.close();
    }
  },
);
