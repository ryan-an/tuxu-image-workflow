const {chromium}=require('C:/Users/root/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
 const b=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const p=await b.newPage({viewport:{width:1440,height:1000}});const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto('http://127.0.0.1:5173/');await p.waitForFunction(()=>window.workflow);await p.evaluate(()=>workflow.state.settings.mode='demo');
 await p.locator('[data-action="view"][data-view="sheet"]').click();await p.waitForFunction(()=>workflow.bridge.workbook);
 const png=await p.evaluate(()=>workflow.state.products[0].photo.split(',')[1]);
 await p.route('**/api/shimo-image',r=>r.fulfill({contentType:'image/png',body:Buffer.from(png,'base64')}));
 await p.evaluate(()=>{const wb=workflow.bridge.workbook,s=wb.getSheetBySheetId('inbox');wb.setActiveSheet(s);s.getRange('A1:E1').setValues([['产品编号','产品名称','尺寸图','卖点图','细节图']]);s.getRange('A2').activate();const urls=['a','b','c'].map(v=>`https://uploader.shimo.im/f/${v}.png?accessToken=test`),html=`<table><tr><td>外部-001</td><td>粘贴的产品</td>${urls.map(u=>`<td><img src="${u}"></td>`).join('')}</tr></table>`,clip=new DataTransfer();clip.setData('text/html',html);document.querySelector('#sheet-container').dispatchEvent(new ClipboardEvent('paste',{clipboardData:clip,bubbles:true,cancelable:true}));});
 await p.waitForFunction(()=>document.querySelector('#toast').textContent.includes('已粘贴 3 张'));
 await p.locator('[data-action="parse-sheet"]').click();await p.locator('[data-action="confirm-parse"]').click();
 await p.waitForFunction(()=>workflow.state.products.length===31);
 const imported=await p.evaluate(()=>{const v=workflow.state.products.find(p=>p.code==='外部-001');return {id:v.id,name:v.name,references:v.tasks.filter(t=>t.references.length).length,task:v.tasks[0].id};});
 assert.equal(imported.name,'粘贴的产品');assert.equal(imported.references,3);
 await p.locator(`[data-action="edit-prompt"][data-task="${imported.task}"]`).click();
 await p.locator(`#prompt-${imported.task}`).fill('保持实物形状，尺寸文字使用产品资料。');
 await p.locator('#prompt-form button[type=submit]').click();await p.waitForFunction(()=>!document.querySelector('#modal').open);
 await p.locator(`[data-action="generate-image"][data-task="${imported.task}"]`).click();await p.waitForFunction(()=>workflow.state.jobs.some(j=>j.status==='completed'));
 // Inserting rows and columns must not break task-to-cell bindings.
 await p.locator('[data-action="view"][data-view="sheet"]').click();
 await p.evaluate(()=>{const s=workflow.bridge.workbook.getSheetBySheetId('preview');s.insertRows(0,1);s.insertColumns(0,1);workflow.bridge.capture();});
 await p.locator('[data-action="view"][data-view="workbench"]').click();
 await p.locator(`[data-action="generate-image"][data-task="${imported.task}"]`).click();await p.waitForFunction(()=>workflow.state.products.find(p=>p.code==='外部-001').tasks[0].versions.length===2);
 const result=await p.evaluate(()=>{const p=workflow.state.products.find(p=>p.code==='外部-001'),t=p.tasks[0],location=workflow.bridge.locate(p,t,'result'),s=workflow.bridge.snapshot().sheets.preview;return {primary:t.primaryId,first:t.versions[0].id,backfilled:Object.values(s.cellData[location.row][location.column]?.p?.drawings||{})[0]?.source===t.versions[0].source};});
 assert.equal(result.primary,result.first);assert.equal(result.backfilled,true);
 await p.evaluate(()=>{workflow.queue.pause(true);workflow.state.concurrency=6;});
 // Exercise the queue engine with 30 complete product sets, without sidebar selection.
 await p.evaluate(()=>workflow.queue.enqueue(workflow.state.products.slice(0,30).flatMap(product=>product.tasks.map(task=>({product,task}))),"workflow"));
 assert.equal(await p.evaluate(()=>workflow.state.jobs.filter(j=>j.status==='queued' && j.kind==='image').length),300);
 assert.equal(await p.evaluate(()=>workflow.state.jobs.filter(j=>j.status==='queued' && j.kind==='prompt-set').length),30);
 await p.evaluate(()=>workflow.queue.pause(false));
 await p.waitForFunction(()=>workflow.state.jobs.filter(j=>j.status==='completed' && j.kind==='image').length===302,{},{timeout:180000});
 assert.equal(await p.evaluate(()=>workflow.state.jobs.filter(j=>j.status==='completed' && j.kind==='prompt-set').length),30);
 assert.equal(await p.evaluate(()=>workflow.state.jobs.filter(j=>j.status==='failed').length),0);
 const completed=await p.evaluate(()=>workflow.state.products.slice(0,30).every(p=>p.tasks.every(t=>t.primaryId&&t.prompt&&t.versions.length)));
 assert.equal(completed,true);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({clipboardThreeImages:true,parsedProduct:true,insertedRowsColumnsKeepBinding:true,promptSets:30,imageTasks:300,batchCompleted:true,errors}));await b.close();
})().catch(e=>{console.error(e);process.exit(1);});
