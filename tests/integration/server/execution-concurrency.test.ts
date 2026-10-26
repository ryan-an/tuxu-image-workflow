import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import {
  fixture,
  fakeProvider,
  counts,
  loginHeaders,
  png,
} from "../../support/production.js";
import { newProduct } from "../../../shared/model.js";
import { Worker } from "../../../server/production/worker.js";
import { WorkspaceWorkers } from "../../../server/production/workspace-workers.js";
import { ProviderError } from "../../../server/production/provider.js";
import { DEFAULT_EXECUTION_LIMITS } from "../../../server/production/execution-limits.js";
import { emptyWorkspace } from "../../../server/production/repository.js";
import { Members } from "../../../server/production/members.js";
import type { Workflows } from "../../../server/production/workflows.js";
import type { Job, Product } from "../../../server/production/types.js";

type Fixture = Awaited<ReturnType<typeof fixture>>;
async function seed(
  workflows: Workflows,
  count: number,
  prefix = "a",
  authors?: string[],
) {
  const photo = await workflows.assets.normalize(png);
  const state = await workflows.repo.view();
  const jobs: Job[] = [];
  await workflows.repo.db.transaction(async (tx) => {
    for (let i = 0; i < count; i++) {
      const product = newProduct(`${prefix}-${i}`) as Product;
      product.photo = photo;
      product.photos = [photo];
      await workflows.repo.saveProduct(tx, product);
      const job: Job = {
        id: `${prefix}-job-${i}`,
        productId: product.id,
        productName: product.name,
        kind: "prompt-set",
        role: "整套提示词",
        status: "queued",
        stage: "pending",
        createdAt: Date.now(),
        mode: "live",
        error: "",
        config: state.settings,
        common: state.common,
        productSnapshot: product,
        taskIds: product.tasks.map((t) => t.id),
        revisions: Object.fromEntries(product.tasks.map((t) => [t.id, 0])),
        ...(authors
          ? {
              createdBy: {
                id: authors[i],
                username: authors[i],
                displayName: authors[i],
              },
            }
          : {}),
      };
      await workflows.repo.insertJob(tx, job);
      jobs.push(job);
    }
  });
  return jobs;
}
async function other(f: Fixture, id = "other") {
  await f.db.query(
    "INSERT INTO workspace(id,document,credential,prompt_credential,created_at) SELECT $1,$2,credential,prompt_credential,$3 FROM workspace WHERE id='default'",
    [id, emptyWorkspace(), Date.now()],
  );
  return f.workspaces.get(id);
}
async function waitFor(
  check: () => boolean | Promise<boolean>,
  timeout = 4000,
) {
  const end = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > end) assert.fail("condition timed out");
    await delay(10);
  }
}
function blockedProvider(onStart: () => void) {
  const provider = fakeProvider(counts());
  const analyze = provider.analyze;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  provider.analyze = async (...args) => {
    onStart();
    const signal = args[4];
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        signal.removeEventListener("abort", abort);
        reject(signal.reason);
      };
      signal.addEventListener("abort", abort, { once: true });
      gate.then(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      });
      if (signal.aborted) abort();
    });
    return analyze(...args);
  };
  return { provider, release };
}

test("15 analyses start together while image submissions and accepted result queries retain independent slots", async (t) => {
  const f = await fixture();
  let started = 0;
  const blocked = blockedProvider(() => started++);
  const worker = new Worker(f.workflows, blocked.provider, () => {});
  try {
    const jobs = await seed(f.workflows, 16);
    const template = jobs[15];
    await f.db.transaction(async (tx) => {
      for (let i = 0; i < 2; i++)
        await f.workflows.repo.insertJob(tx, {
          ...template,
          id: `image-${i}`,
          kind: "image",
          taskId: template.productSnapshot!.tasks[i].id,
          prompt: "ready",
          referenceImages: [f.product.photo],
          dependsOn: undefined,
          ...(i === 1
            ? { remoteId: "accepted-remote-id", stage: "polling" }
            : {}),
        });
    });
    t.mock.method(f.workflows.repo, "view", async () => {
      throw Error("worker must not load full snapshots");
    });
    worker.start();
    await waitFor(() => started === 15);
    await waitFor(
      async () =>
        (await f.workflows.repo.job("image-1"))?.status === "completed",
    );
    assert.equal((await f.workflows.repo.job("image-0"))?.remoteId, "remote-1");
    assert.equal(
      (
        await f.db.query(
          "SELECT COUNT(*) AS count FROM jobs WHERE kind='prompt-set' AND status='running'",
        )
      ).rows[0].count,
      15,
    );
    blocked.release();
    await waitFor(
      async () =>
        (
          await f.db.query(
            "SELECT COUNT(*) AS count FROM jobs WHERE kind='prompt-set' AND status='completed'",
          )
        ).rows[0].count === 16,
    );
  } finally {
    blocked.release();
    await worker.stop();
    await f.close();
  }
});

test("server limits are atomic across workspace workers and the manager interleaves teams", async () => {
  const f = await fixture(undefined, undefined, {
    ...DEFAULT_EXECUTION_LIMITS,
    prompt: 4,
  });
  const b = await other(f);
  let aStarted = 0,
    bStarted = 0;
  const aBlock = blockedProvider(() => aStarted++),
    bBlock = blockedProvider(() => bStarted++);
  const workers = new WorkspaceWorkers(
    f.workspaces,
    () => {},
    () => {},
    (workflows) =>
      workflows.repo.workspaceId === "default"
        ? aBlock.provider
        : bBlock.provider,
  );
  try {
    await seed(f.workflows, 6, "a");
    await seed(b, 6, "b");
    await workers.start();
    await waitFor(() => aStarted + bStarted === 4);
    await delay(1100);
    assert.equal(aStarted + bStarted, 4);
    assert.ok(aStarted > 0 && bStarted > 0);
    // A second process/Worker instance still cannot claim above the persisted cap.
    assert.equal(
      await b.repo.claim("another-process", Date.now(), "prompt"),
      null,
    );
    await workers.stop();
    const interrupted = (
      await f.db.query(
        "SELECT COUNT(*) AS count FROM jobs WHERE status='interrupted'",
      )
    ).rows[0].count;
    assert.equal(interrupted, 4);
    await f.reopen();
    assert.equal(
      (
        await f.db.query(
          "SELECT COUNT(*) AS count FROM jobs WHERE status='interrupted'",
        )
      ).rows[0].count,
      4,
    );
  } finally {
    aBlock.release();
    bBlock.release();
    await workers.stop();
    await f.close();
  }
});

test("pending work rotates members rather than dispatching one member's whole batch first", async () => {
  const f = await fixture();
  try {
    await seed(f.workflows, 5, "fair", ["a", "a", "a", "b", "c"]);
    const claimed = [];
    for (let i = 0; i < 4; i++)
      claimed.push(
        (await f.workflows.repo.claim(`owner-${i}`, Date.now(), "prompt"))!
          .createdBy!.id,
      );
    assert.deepEqual(claimed, ["a", "b", "c", "a"]);
  } finally {
    await f.close();
  }
});

test("definitive 429 backs off the affected model, preserves other models, and retries only after cooldown", async () => {
  const f = await fixture();
  try {
    const jobs = await seed(f.workflows, 3, "rate");
    jobs[2].config = { ...jobs[2].config, promptModel: "different-model" };
    await f.workflows.repo.saveJob(f.db, jobs[2]);
    const provider = fakeProvider(counts());
    provider.analyze = async () => {
      throw new ProviderError(
        "rate limited",
        true,
        true,
        { status: 429, code: "ModelAccountTpmRateLimitExceeded" },
        10000,
      );
    };
    await new Worker(f.workflows, provider, () => {}).step("prompt");
    const limited = (await f.workflows.repo.job(jobs[0].id))!;
    assert.equal(limited.status, "queued");
    assert.equal(limited.rateLimitRetries, 1);
    assert.ok(limited.rateLimitUntil! > Date.now());
    const next = await f.workflows.repo.claim(
      "other-model",
      Date.now(),
      "prompt",
    );
    assert.equal(next?.id, jobs[2].id);
    assert.equal(
      await f.workflows.repo.claim("blocked-model", Date.now(), "prompt"),
      null,
    );
    await f.db.query("UPDATE model_cooldowns SET retry_until=0");
    await f.due();
    assert.ok(await f.workflows.repo.claim("resumed", Date.now(), "prompt"));
  } finally {
    await f.close();
  }
});

test("quota exhaustion and unknown acceptance never enter automatic rate-limit retries", async () => {
  for (const code of ["QuotaExceeded", "unknown-acceptance"]) {
    const f = await fixture();
    try {
      const [job] = await seed(f.workflows, 1);
      const provider = fakeProvider(counts());
      provider.analyze = async () => {
        throw code === "QuotaExceeded"
          ? new ProviderError("quota used", false, true, { status: 429, code })
          : new Error("connection lost");
      };
      const worker = new Worker(f.workflows, provider, () => {});
      await worker.step("prompt");
      const saved = (await f.workflows.repo.job(job.id))!;
      assert.equal(
        saved.status,
        code === "QuotaExceeded" ? "failed" : "interrupted",
      );
      assert.equal(await worker.step("prompt"), false);
      assert.equal(saved.rateLimitUntil, undefined);
    } finally {
      await f.close();
    }
  }
});

test("concurrency settings persist, reject invalid values, and require ownership", async () => {
  const f = await fixture();
  try {
    const owner = await loginHeaders(f.app);
    const edit = (headers: any, field: string, value: number) =>
      f.app.inject({
        method: "PATCH",
        url: "/api/workspace",
        headers,
        payload: { edits: [{ path: [field], before: 1, value }] },
      });
    assert.equal((await edit(owner, "promptConcurrency", 20)).statusCode, 200);
    assert.equal((await edit(owner, "queryConcurrency", 12)).statusCode, 200);
    assert.equal((await edit(owner, "promptConcurrency", 31)).statusCode, 400);
    await new Members(f.db).create({
      username: "editor",
      displayName: "editor",
      password: "editor-password",
      role: "editor",
      monthlyLimit: null,
    });
    const login = await f.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "editor", password: "editor-password" },
    });
    const editor = {
      cookie: String(login.headers["set-cookie"]).split(";")[0],
    };
    assert.equal((await edit(editor, "promptConcurrency", 15)).statusCode, 403);
    await f.reopen();
    const state = await f.workflows.repo.view();
    assert.equal(state.promptConcurrency, 20);
    assert.equal(state.queryConcurrency, 12);
    assert.equal(state.concurrency, 2);
    assert.deepEqual(
      (
        await f.app.inject({ url: "/api/execution/limits", headers: owner })
      ).json(),
      { prompt: 15, submit: 6, query: 8 },
    );
  } finally {
    await f.close();
  }
});
