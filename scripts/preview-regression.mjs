// Isolated UI review environment. Never reads .env or calls a paid provider.
import { resolve } from "node:path";
import { fixture, fakeProvider, counts, password } from "../build-test/server/production/test-support.js";
import { Worker } from "../build-test/server/production/worker.js";

const environment = await fixture(resolve("dist"));
const worker = new Worker(environment.workflows, fakeProvider(counts()));
await environment.app.listen({ host: "127.0.0.1", port: 5183 });
let running = false;
const timer = setInterval(async () => {
  if (running) return;
  running = true;
  try { await environment.due(); await worker.step(); }
  catch (error) { console.error(error.message); }
  finally { running = false; }
}, 1000);
console.log("隔离回归工作区：http://127.0.0.1:5183（生产前端与 API，临时测试数据库、模拟平台）");
console.log(`测试登录：admin / ${password}`);
console.log("此工作区不读取你的工作流和 API Key；关闭后不保留测试数据。");
async function close() { clearInterval(timer); await environment.close(); process.exit(0); }
process.once("SIGINT", close);
process.once("SIGTERM", close);
