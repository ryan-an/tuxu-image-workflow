const { artifactPath } = require("../support/artifacts.cjs");
const { chromium } = require('C:/Users/root/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const fs = require('node:fs/promises');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:5173/');
    await page.waitForFunction(() => window.workflow);
    const ids = await page.evaluate(async () => {
      const { addVersion } = await import('/shared/model.js');
      const [first, second] = workflow.state.products;
      const task = first.tasks[0];
      for (const p of workflow.state.products) for (const t of p.tasks) t.selectedIds = [];
      addVersion(second.tasks[0], second.photo, '另一套图片', 'demo');
      workflow.state.settings.mode = 'demo';
      workflow.state.paused = true;
      return { first: first.id, second: second.id, firstCode: first.code, secondCode: second.code,
        task: task.id, v1: task.versions[0].id, v2: task.versions[1].id, secondVersion: second.tasks[0].versions[0].id };
    });
    await page.locator('[data-action=view][data-view=workbench]').click();
    assert.equal(await page.locator('#sidebar-content input[type=checkbox]').count(), 0);
    assert.equal(await page.locator('[data-action=toggle-batch-selection]').count(), 0);
    assert.equal(await page.locator('[data-action=select-task]').count(), 0);
    assert.equal(await page.locator('[data-action=all-tasks]').count(), 0);
    assert.ok(!(await page.locator('#batch-bar').textContent()).includes('所选产品'));
    assert.equal(await page.locator('#download-current').isDisabled(), true);
    // History clicks choose the displayed result and exactly one download version.
    await page.locator(`[data-action=select-version][data-version="${ids.v1}"]`).check();
    await page.locator(`[data-action=choose-version][data-version="${ids.v2}"]`).click();
    let choice = await page.evaluate(() => ({ primary: workflow.state.products[0].tasks[0].primaryId,
      selected: workflow.state.products[0].tasks[0].selectedIds }));
    assert.equal(choice.primary, ids.v2);
    assert.deepEqual(choice.selected, [ids.v2]);
    assert.equal(await page.locator('#modal').evaluate(e => e.open), false);
    assert.equal(await page.locator(`[data-action=select-version][data-version="${ids.v1}"]`).isChecked(), false);
    await page.locator(`[data-action=select-version][data-version="${ids.v2}"]`).uncheck();
    assert.equal(await page.evaluate(() => workflow.state.products[0].tasks[0].primaryId), ids.v2);
    assert.equal(await page.locator('#download-current').isDisabled(), true);
    await page.locator(`[data-action=select-version][data-version="${ids.v1}"]`).check();
    assert.equal(await page.evaluate(() => workflow.state.products[0].tasks[0].primaryId), ids.v1);
    // A checked result on another product must not enter this product's download.
    await page.locator(`[data-action=open-product][data-id="${ids.second}"]`).click();
    await page.locator(`[data-action=select-version][data-version="${ids.secondVersion}"]`).check();
    await page.locator(`[data-action=open-product][data-id="${ids.first}"]`).click();
    const pending = page.waitForEvent('download');
    await page.locator('[data-action=download-selected]').click();
    await (await pending).saveAs(artifactPath("current-product-check.zip"));
    const zip = await JSZip.loadAsync(await fs.readFile(artifactPath("current-product-check.zip")));
    const files = Object.keys(zip.files).filter(name => !zip.files[name].dir);
    assert.equal(files.length, 1);
    assert.ok(files[0].startsWith(`${ids.firstCode}/`) && files[0].endsWith('V1.png'));
    assert.ok(!files.some(name => name.includes(ids.secondCode)));
    await page.locator(`[data-action=select-version][data-version="${ids.v1}"]`).uncheck();
    assert.equal(await page.locator('#download-current').isDisabled(), true);
    // No checked versions are required to analyze the entire current set.
    await page.locator('[data-action=batch-prompt]').click();
    const jobs = await page.evaluate(() => workflow.state.jobs.map(job => ({ productId: job.productId, kind: job.kind, taskIds: job.taskIds })));
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].productId, ids.first);
    assert.equal(jobs[0].kind, 'prompt-set');
    assert.equal(jobs[0].taskIds.length, 10);
    await page.locator('[data-action=filter-tasks][data-filter=selected]').click();
    assert.equal(await page.locator('.task-card').count(), 1);
    await page.locator('[data-action=batch-workflow]').click();
    const imageJobs = await page.evaluate(() => workflow.state.jobs.filter(job => job.kind === 'image').map(job => job.productId));
    assert.equal(imageJobs.length, 10);
    assert.ok(imageJobs.every(id => id === ids.first));
    await page.locator('[data-action=filter-tasks][data-filter=all]').click();
    await page.screenshot({ path: artifactPath("current-product-preview.png") });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ noSidebarSelections: true, noGenerationCheckboxes: true, downloadOnlyCurrentProduct: true,
      historyClickChoosesAndChecks: true, oneVersionPerTask: true, uncheckPreservesDisplay: true, wholeSetPromptWithoutChecks: true, imageJobs: 10, errors }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
