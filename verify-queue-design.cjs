const {chromium}=require('C:/Users/root/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');const JSZip=require('jszip');const fs=require('node:fs/promises');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1040},acceptDownloads:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let config={mode:'demo',hasKey:true,baseUrl:'https://grsai.dakka.com.cn',imageModel:'nano-banana-2',promptModel:'gemini-3.1-pro',aspectRatio:'1:1',imageSize:'1K',gptSize:'1024x1024',quality:'auto'};
  await page.route('**/api/workflow/settings',route=>{
   if(route.request().method()==='POST'){const {apiKey,...safe}=route.request().postDataJSON();config={...config,...safe};}
   return route.fulfill({json:config});
  });
  await page.goto('http://127.0.0.1:5173/');await page.waitForFunction(()=>window.workflow);
  await page.click('#models-button');await page.locator('#prompt-model').selectOption('gemini-3.8-flash');
  await page.locator('#image-model').selectOption('gpt-image-2');await page.locator('#settings-form button[type=submit]').click();
  assert.equal(config.promptModel,'gemini-3.8-flash');assert.equal(config.imageModel,'gpt-image-2');
  await page.click('#models-button');await page.locator('#prompt-model').selectOption('__custom');
  await page.locator('[name=customPromptModel]').fill('custom-vision-model');await page.locator('#settings-form button[type=submit]').click();
  await page.click('#models-button');assert.equal(await page.locator('#prompt-model').inputValue(),'custom-vision-model');await page.locator('[data-action=close-modal]').click();
  const ids=await page.evaluate(async()=>{
   const {demoImage}=await import('/src/demo-images.js');const {addVersion}=await import('/src/model.js');
   for(const p of workflow.state.products){p.photo ||= demoImage(p,'实拍示意');for(const t of p.tasks){if(!t.versions.length)addVersion(t,demoImage(p,t.role),'演示提示词','demo');t.prompt='用于验证队列按钮的演示提示词';t.primaryId=null;t.selectedIds=[];}}
   const p=workflow.state.products[0],t=p.tasks[0];for(let i=0;i<10;i++)addVersion(t,demoImage(p,t.role,i),'演示','demo');
   for(const p of workflow.state.products){for(const t of p.tasks){t.primaryId=null;t.selectedIds=[];}}
   for(const p of workflow.state.products.slice(0,2)){const t=p.tasks[0];t.primaryId=t.versions[0].id;t.selectedIds=[t.primaryId];}
   workflow.state.paused=true;
   return {first:p.id,second:workflow.state.products[1].id,secondCode:workflow.state.products[1].code,retryTask:p.tasks[1].id,last:workflow.state.products.at(-1).id};
  });
  await page.locator('[data-action=view][data-view=queue]').click();
  assert.equal(await page.locator('.batch-queue-table tbody tr').count(),30);
  assert.equal((await page.locator('#queue-generated').textContent()).trim(),'300 / 300');
  assert.equal((await page.locator('#queue-history').textContent()).trim(),'311');
  assert.equal((await page.locator('#queue-selected').textContent()).trim(),'2');
  assert.equal(await page.locator('.queue-job-details').getAttribute('open'),null);
  await page.screenshot({path:'queue-design-preview.png'});
  await page.locator(`[data-product-row="${ids.second}"] [data-action=queue-open-product]`).click();
  assert.equal(await page.evaluate(()=>workflow.state.activeProductId),ids.second);assert.equal(await page.locator('.task-card').count(),10);
  await page.locator('[data-action=view][data-view=queue]').click();
  await page.evaluate(({first,retryTask})=>{
   workflow.state.jobs.push({id:'failed-for-test',productId:first,taskId:retryTask,productName:'测试产品',role:'卖点图',kind:'image',status:'failed',createdAt:Date.now(),error:'演示失败',mode:'demo',config:{}});
   const t=workflow.state.products.at(-1).tasks.at(-1);t.versions=[];t.selectedIds=[];t.primaryId=null;
  },ids);
  await page.locator('[data-action=view][data-view=queue]').click();
  await page.locator('[data-action=retry-failed]').click();
  assert.equal(await page.evaluate(()=>workflow.state.jobs.filter(j=>j.status==='queued').length),1);
  await page.locator('[data-action=generate-remaining]').click();
  assert.equal(await page.evaluate(()=>workflow.state.jobs.filter(j=>j.status==='queued').length),2);
  await page.locator('[data-action=pause-queue]').click();
  await page.waitForFunction(()=>workflow.state.jobs.filter(j=>j.status==='completed').length===2);
  assert.equal((await page.locator('#queue-generated').textContent()).trim(),'300 / 300');
  const pending=page.waitForEvent('download');await page.locator('[data-action=download-batch-selected]').click();
  const download=await pending;await download.saveAs('queue-selected-check.zip');
  const zip=await JSZip.loadAsync(await fs.readFile('queue-selected-check.zip'));
  assert.ok(Object.keys(zip.files).some(name=>name.includes(ids.secondCode)&&!zip.files[name].dir));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({productRows:30,generatedSlots:300,history:311,modelDropdown:true,customModel:true,retryFailed:true,generateRemaining:true,openProduct:true,wholeBatchExport:true,errors}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1)});
