const { artifactPath } = require("../support/artifacts.cjs");
const { chromium } = require('C:/Users/root/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch({ headless:true, executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe' });
 try {
  const page = await browser.newPage({ viewport:{width:1440,height:1000} });
  const errors=[]; page.on('pageerror', error=>errors.push(error.message));
  await page.route('**/api/workflow/settings', route => route.fulfill({json:{mode:'live',hasKey:true,baseUrl:'https://grsai.dakka.com.cn',imageModel:'nano-banana-2',promptModel:'gemini-3.1-pro',aspectRatio:'1:1',imageSize:'1K'}}));
  await page.goto('http://127.0.0.1:5173/'); await page.waitForFunction(()=>window.workflow);
  const fixture = await page.evaluate(async()=>{
   const { demoSuite }=await import('/shared/prompt-suite.js');
   const p=workflow.state.products[0]; p.name='25 个装金属亮面红色气泡信封';p.facts='外尺寸：宽度24 cm x 高28 cm\n品牌：Blcculi';
   p.photos=[p.photo, p.tasks[0].references[0]];
   const set=demoSuite(p);set.prompts[2].photoIndices=[1];
   return { set, firstPhoto:p.photo, detailPhoto:p.photos[1], references:p.tasks.map(t=>t.references[0]), ids:p.tasks.map(t=>t.id) };
  });
  let analysisCalls=0, imageCalls=0;
  await page.route('**/api/workflow/prompt-set', async route=>{
   analysisCalls++;const body=route.request().postDataJSON();assert.equal(body.product.tasks.length,10);
   assert.ok(body.common.includes('一次识别整套'));assert.ok(body.product.facts.includes('Blcculi'));
   await new Promise(resolve=>setTimeout(resolve,120));
   const result=await page.evaluate(async ({product,common})=>{
    const {demoSuite}=await import('/shared/prompt-suite.js');
    const result=demoSuite(product,common);result.prompts[2].photoIndices=[1];return result;
   },body);
   if(analysisCalls>1) result.prompts.forEach(item=>item.prompt=item.prompt.replace('演示布局：','演示布局第2版：'));
   return route.fulfill({json:result});
  });
  await page.route('**/api/workflow/image', route=>{
   imageCalls++;const body=route.request().postDataJSON();
   assert.ok(!('common' in body));assert.ok(!body.prompt.includes('只发给分析模型的测试标记'));
   assert.deepEqual(body.referenceImages,[fixture.detailPhoto]);
   assert.ok(body.prompt.includes('第三部份'));return route.fulfill({json:{id:'one-image',status:'succeeded',image:fixture.firstPhoto}});
  });
  assert.equal(await page.locator('[data-action="generate-prompt"]').count(),1);
  await page.locator('[data-action="generate-prompt"]').click();
  await page.waitForFunction(()=>workflow.state.jobs.some(j=>j.kind==='prompt-set'&&j.status==='completed'));
  assert.equal(analysisCalls,1); assert.equal(imageCalls,0);
  const setCheck = await page.evaluate(()=>{
   const p=workflow.state.products[0];return {parts:p.tasks.map(t=>[1,2,3,4].every(n=>t.prompt.includes(['第一部份','第二部份','第三部份','第四部份'][n-1]))),styles:[...new Set(p.tasks.map(t=>t.prompt.split('第二部份：')[1].split('第三部份：')[0]))],ids:[...new Set(p.tasks.map(t=>t.promptSetId))],size:p.tasks.map(t=>t.prompt.includes(t.role.startsWith('A+')?'970X600像素':'1610X1610像素')),brand:p.tasks[6].prompt.includes('Blcculi'),quantity:p.tasks[0].prompt.includes('25 Pack 24 cm x 28 cm')};
  });
  assert.ok(setCheck.parts.every(Boolean));assert.equal(setCheck.styles.length,1);assert.equal(setCheck.ids.length,1);assert.ok(setCheck.size.every(Boolean));assert.ok(setCheck.brand&&setCheck.quantity);
  await page.locator(`[data-action="generate-image"][data-task="${fixture.ids[2]}"]`).click();
  await page.waitForFunction(()=>workflow.state.jobs.some(j=>j.kind==='image'&&j.status==='completed'));
  assert.equal(imageCalls,1);assert.equal(analysisCalls,1);
  await page.locator('[data-action="generate-prompt"]').click();
  await page.waitForFunction(()=>workflow.state.products[0].promptSets.length===2);
  assert.equal(analysisCalls,2);
  assert.ok(await page.evaluate(()=>workflow.state.products[0].tasks.every(t=>t.promptHistory.length)));
  await page.locator('[data-action="view"][data-view="sheet"]').click();await page.waitForFunction(()=>workflow.bridge.workbook);
  assert.ok(await page.evaluate(()=>Array.from({length:10},(_,i)=>workflow.bridge.snapshot().sheets.preview.cellData[2][i+4].v).every(p=>p.includes('第三部份')&&p.includes('分辨率300'))));
  await page.locator('[data-action="view"][data-view="workbench"]').click();
  await page.screenshot({path:artifactPath("suite-workflow-preview.png")});
  await page.reload();await page.waitForFunction(()=>window.workflow);
  assert.equal(await page.evaluate(()=>workflow.state.products[0].promptSets.length),2);
  await page.locator('[data-action="common-prompt"]').click();
  const input=page.locator('#common-form [name="common"]');
  const editable=await input.inputValue();assert.ok(editable.includes('必须严格使用我上传的实拍'));
  const edited=('只发给分析模型的测试标记\n'+editable).replace('出现的产品不能带有LOGO','保留实拍产品原有标识，不额外添加标识').replace('1610X1610','2000X2000').replace('970X600','1200X800').replaceAll('分辨率300','分辨率150');
  await input.fill(edited);await page.locator('#common-form button[type=submit]').click();
  await page.locator('[data-action="generate-prompt"]').click();
  await page.waitForFunction(()=>workflow.state.products[0].promptSets.length===3);
  assert.equal(analysisCalls,3);
  const newPrompts=await page.evaluate(()=>workflow.state.products[0].tasks.map(t=>t.prompt));
  assert.ok(newPrompts[0].includes('2000X2000像素'));assert.ok(newPrompts[6].includes('1200X800像素'));
  assert.ok(newPrompts.every(p=>p.includes('保留实拍产品原有标识')&&p.includes('分辨率150')&&!p.includes('出现的产品不能带有LOGO')));
  await page.locator(`[data-action="generate-image"][data-task="${fixture.ids[2]}"]`).click();
  await page.waitForFunction(()=>workflow.state.jobs.filter(j=>j.kind==='image'&&j.status==='completed').length===2);
  await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#save-status').textContent==='已保存到本机');
  await page.reload();await page.waitForFunction(()=>window.workflow);
  assert.equal(await page.evaluate(()=>workflow.state.common),edited);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({oneRequestPerProduct:true,fourParts:true,sharedStyle:true,userRulesPreserved:true,allRulesEditable:true,analysisRulesNotSentToImages:true,sizes:true,brandAndQuantity:true,realPhotosOnly:true,tenCellBackfill:true,reloadHistory:true,errors}));
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exit(1)});
