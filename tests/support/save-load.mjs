// Run after npm run test:build. Optional --baseline-ref HEAD compares the
// unmodified save implementation at that Git revision, without a checkout.
import { execFileSync } from "node:child_process";
import { stripTypeScriptTypes } from "node:module";
import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  fixture,
  loginHeaders,
  pairs,
} from "../../build-test/tests/support/production.js";
import { newProduct } from "../../build-test/shared/model.js";
import { artifactPath } from "./artifacts.cjs";

const refIndex = process.argv.indexOf("--baseline-ref");
const baselineRef = refIndex >= 0 ? process.argv[refIndex + 1] : undefined;
if (refIndex >= 0 && !baselineRef)
  throw Error("--baseline-ref requires a Git revision");
const f = await fixture();
try {
  await f.workflows.enqueue(randomUUID(), pairs(f.product), "prompt-set");
  const products = [];
  await f.db.transaction(async (tx) => {
    const state = await f.workflows.repo.view(tx);
    const original = state.jobs[0];
    original.status = "completed";
    original.stage = "completed";
    await f.workflows.repo.saveJob(tx, original);
    for (let i = 0; i < 100; i++) {
      const product =
        i === 0
          ? state.products[0]
          : newProduct(`LOAD-${i}`, `Product ${i}`, "Synthetic product data");
      for (const task of product.tasks) {
        task.prompt = "saved prompt ".repeat(50);
        task.promptHistory = Array.from({ length: 2 }, () => ({
          prompt: "old saved prompt ".repeat(30),
          createdAt: 1,
        }));
      }
      await f.workflows.repo.saveProduct(tx, product);
      products.push(product);
    }
    for (let i = 0; i < 500; i++) {
      const product = products[i % products.length];
      await f.workflows.repo.insertJob(tx, {
        ...original,
        id: `load-history-${i}`,
        productId: product.id,
        productSnapshot: product,
        createdAt: original.createdAt + i + 1,
        analysisResponse: "historical provider response ".repeat(100),
      });
    }
  });
  const headers = {
    ...(await loginHeaders(f.app)),
    "x-workspace-view": "compact",
    "x-workspace-products": "[]",
    "x-workspace-result": "delta",
    "content-type": "application/json",
  };
  const base = await f.app.listen({ host: "127.0.0.1", port: 0 });
  async function run(label) {
    const times = [],
      status = {};
    let bytes = 0;
    const start = performance.now();
    await Promise.all(
      Array.from({ length: 15 }, async (_, client) => {
        for (let i = 0; i < 2; i++) {
          const began = performance.now();
          const response = await fetch(`${base}/api/workspace`, {
            method: "PATCH",
            headers,
            signal: AbortSignal.timeout(30000),
            body: JSON.stringify({
              edits: [
                {
                  path: ["products", products[client].id, "name"],
                  before:
                    i === 0 ? products[client].name : `Edited ${client}-0`,
                  value: `Edited ${client}-${i}`,
                },
              ],
            }),
          });
          bytes += (await response.arrayBuffer()).byteLength;
          status[response.status] = (status[response.status] || 0) + 1;
          times.push(performance.now() - began);
        }
      }),
    );
    const elapsed = performance.now() - start;
    times.sort((a, b) => a - b);
    const percentile = (p) =>
      Math.round(times[Math.ceil(times.length * p) - 1]);
    const result = {
      label,
      concurrency: 15,
      requests: times.length,
      seconds: +(elapsed / 1000).toFixed(2),
      requestsPerSecond: +((times.length / elapsed) * 1000).toFixed(1),
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      maxMs: percentile(1),
      averageResponseBytes: Math.round(bytes / times.length),
      status,
    };
    console.log(JSON.stringify(result));
    if (status[200] !== 30)
      throw Error("Load test returned unsuccessful responses");
    return result;
  }
  const report = {
    dataset: { products: 100, historicalJobs: 501 },
    scope:
      "Loopback HTTP; one authenticated session; no worker, SSE, image transfer, proxy or public network",
    results: [],
  };
  if (baselineRef) {
    const source = execFileSync(
      "git",
      ["show", `${baselineRef}:./server/production/workflows.ts`],
      { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
    );
    const compiled = stripTypeScriptTypes(source, {
      mode: "transform",
    }).replace(
      /from (["'])(\.{1,2}\/[^"']+)\1/g,
      (_match, _quote, specifier) =>
        `from ${JSON.stringify(new URL(specifier, new URL("../../build-test/server/production/workflows.js", import.meta.url)).href)}`,
    );
    const { Workflows } = await import(
      `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
    );
    const optimized = f.workflows.edit;
    f.workflows.edit = Workflows.prototype.edit;
    report.results.push(await run(`baseline:${baselineRef}`));
    f.workflows.edit = optimized;
    await f.db.transaction(async (tx) => {
      for (const product of products)
        await f.workflows.repo.saveProduct(tx, product);
    });
  }
  report.results.push(await run("incremental"));
  const path = artifactPath("save-load.json");
  await writeFile(path, JSON.stringify(report, null, 2) + "\n");
  console.log(`Report: ${path}`);
} finally {
  await f.close();
}
