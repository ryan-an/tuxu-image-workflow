const {chromium}=require('C:/Users/root/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
 const b=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}),p=await b.newPage();let submits=0,queries=0;
 await p.route('**/api/workflow/settings',r=>r.fulfill({json:{mode:'live',hasKey:true,baseUrl:'https://grsai.dakka.com.cn',imageModel:'gpt-image-2',promptModel:'gemini-3.1-pro',gptSize:'1024x1024',quality:'auto',aspectRatio:'1:1',imageSize:'1K'}}));
 await p.route('**/api/workflow/image',r=>{submits++;return r.fulfill({json:{id:'retained-platform-job',status:'running'}});});
 let source;
 await p.route('**/api/workflow/result',r=>{queries++;return r.fulfill({json:{id:'retained-platform-job',status:'succeeded',image:source}});});
 await p.goto('http://127.0.0.1:5173/');await p.waitForFunction(()=>window.workflow);source=await p.evaluate(()=>workflow.state.products[0].tasks[0].versions[0].source);
 await p.locator('[data-action="generate-image"]').first().click();await p.waitForFunction(()=>workflow.state.jobs[0]?.remoteId==='retained-platform-job');
 // The provider must persist the ID itself before its first polling request.
 await p.waitForTimeout(150);await p.reload();await p.waitForFunction(()=>window.workflow);
 assert.equal(await p.evaluate(()=>workflow.state.jobs[0].status),'interrupted');
 assert.equal(await p.evaluate(()=>workflow.state.jobs[0].remoteId),'retained-platform-job');
 await p.locator('[data-action="view"][data-view="queue"]').click();await p.locator('[data-action="resume-interrupted"]').click();
 await p.waitForFunction(()=>workflow.state.jobs[0].status==='completed');
 assert.equal(submits,1);assert.ok(queries>=1);assert.equal(await p.evaluate(()=>workflow.state.products[0].tasks[0].versions.length),3);
 console.log(JSON.stringify({submitCount:submits,queries,resumeWithoutResubmission:true}));await b.close();
})().catch(e=>{console.error(e);process.exit(1);});
