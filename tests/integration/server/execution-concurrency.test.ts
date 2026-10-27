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
import {
  executionLimitsFromEnv,
  type ExecutionLane,
} from "../../../server/production/execution-limits.js";
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
function blockedProvider(onStart: (lane: ExecutionLane) => void) {
  const provider = fakeProvider(counts());
  const { analyze, submit, query } = provider;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const block = async (lane: ExecutionLane, signal: AbortSignal) => {
    onStart(lane);
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
  };
  provider.analyze = async (...args) => {
    await block("prompt", args[4]);
    return analyze(...args);
  };
  provider.submit = async (...args) => {
    await block("submit", args[4]);
    return submit(...args);
  };
  provider.query = async (...args) => {
    await block("query", args[3]);
    return query(...args);
  };
  return { provider, release };
}

test("all ready analyses, submissions and queries start without server or legacy workspace caps", async (t) => {
  const f = await fixture(
    undefined,
    undefined,
    executionLimitsFromEnv({
      EXECUTION_PROFILE: "small",
      PROMPT_CONCURRENCY_LIMIT: "1",
      IMAGE_SUBMIT_CONCURRENCY_LIMIT: "1",
      IMAGE_QUERY_CONCURRENCY_LIMIT: "1",
    }),
  );
  const started = { prompt: 0, submit: 0, query: 0 };
  const blocked = blockedProvider((lane) => started[lane]++);
  const worker = new Worker(f.workflows, blocked.provider, () => {});
  try {
    await f.workflows.edit(
      ["concurrency", "promptConcurrency", "queryConcurrency"].map((field) => ({
        path: [field],
        before: 2,
        value: 1,
      })),
    );
    const jobs = await seed(f.workflows, 40);
    await f.db.transaction(async (tx) => {
      for (const [i, template] of jobs.entries()) {
        for (let slot = 0; slot < 2; slot++)
          await f.workflows.repo.insertJob(tx, {
            ...template,
            id: `image-${i}-${slot}`,
            kind: "image",
            taskId: template.productSnapshot!.tasks[slot].id,
            prompt: "ready",
            referenceImages: [f.product.photo],
            dependsOn: undefined,
            ...(slot === 1
              ? { remoteId: `accepted-${i}`, stage: "polling" }
              : {}),
          });
      }
    });
    t.mock.method(f.workflows.repo, "view", async () => {
      throw Error("worker must not load full snapshots");
    });
    worker.start();
    await waitFor(
      () => Object.values(started).every((count) => count === 40),
      10000,
    );
    assert.equal(
      (
        await f.db.query(
          "SELECT COUNT(*) AS count FROM jobs WHERE status='running'",
        )
      ).rows[0].count,
      120,
    );
    // Cancellation uses one listener per worker even with many network requests.
    assert.equal(f.workflows.analysisEvents.listenerCount("cancel"), 1);
    blocked.release();
    await waitFor(
      async () =>
        (
          await f.db.query(
            "SELECT COUNT(*) AS count FROM jobs WHERE status='completed'",
          )
        ).rows[0].count === 120,
      10000,
    );
    assert.equal(f.workflows.analysisEvents.listenerCount("cancel"), 0);
  } finally {
    blocked.release();
    await worker.stop();
    await f.close();
  }
});

test("workspace workers drain ready work independently of idle teams and preserve interruption on restart", async (t) => {
  const f = await fixture();
  // More empty teams than the old server cap must not consume dispatch turns.
  for (let i = 0; i < 7; i++) await other(f, `empty-${i}`);
  const b = await other(f, "last-team");
  let aStarted = 0,
    bStarted = 0;
  const createdWorkers: string[] = [];
  const aBlock = blockedProvider(() => aStarted++),
    bBlock = blockedProvider(() => bStarted++);
  const workers = new WorkspaceWorkers(
    f.workspaces,
    () => {},
    () => {},
    (workflows) => {
      createdWorkers.push(workflows.repo.workspaceId);
      return workflows.repo.workspaceId === "default"
        ? aBlock.provider
        : bBlock.provider;
    },
  );
  try {
    t.mock.method(f.workspaces, "all", async () => {
      throw Error("must not poll idle workspaces");
    });
    await workers.start();
    assert.deepEqual(createdWorkers, []);
    await seed(f.workflows, 20, "a");
    await seed(b, 20, "b");
    await waitFor(() => aStarted === 20 && bStarted === 20, 10000);
    assert.deepEqual(createdWorkers.sort(), ["default", "last-team"]);
    await workers.stop();
    assert.equal(
      (
        await f.db.query(
          "SELECT COUNT(*) AS count FROM jobs WHERE status='interrupted'",
        )
      ).rows[0].count,
      40,
    );
    await f.reopen();
    assert.equal(
      (
        await f.db.query(
          "SELECT COUNT(*) AS count FROM jobs WHERE status='interrupted'",
        )
      ).rows[0].count,
      40,
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

test("legacy concurrency fields remain compatible but the limits endpoint reports no caps", async () => {
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
    assert.equal((await edit(owner, "concurrency", 10000)).statusCode, 200);
    assert.equal((await edit(owner, "promptConcurrency", 0)).statusCode, 400);
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
    assert.equal(state.concurrency, 10000);
    assert.deepEqual(
      (
        await f.app.inject({ url: "/api/execution/limits", headers: owner })
      ).json(),
      { prompt: null, submit: null, query: null },
    );
  } finally {
    await f.close();
  }
});

test("429 cooldown is isolated by workspace and credential version, including key rotation during a request", async () => {
  const f = await fixture();
  try {
    const b = await other(f);
    await b.updateSettings({ promptApiKey: "independent-key" });
    const jobs = await seed(f.workflows, 3, "limited");
    const otherJobs = await seed(b, 2, "independent");
    const provider = fakeProvider(counts());
    provider.analyze = async () => {
      throw new ProviderError(
        "rate limited",
        true,
        true,
        { status: 429, code: "RateLimitExceeded" },
        10000,
      );
    };
    await new Worker(f.workflows, provider, () => {}).step("prompt");
    assert.equal(
      await f.workflows.repo.claim("blocked", Date.now(), "prompt"),
      null,
    );
    assert.equal(
      (await b.repo.claim("independent", Date.now(), "prompt"))?.id,
      otherJobs[0].id,
    );
    // The limited job keeps its own retry delay, but new work can use the new key.
    await f.workflows.updateSettings({ promptApiKey: "replacement-key" });
    assert.equal(
      (await f.workflows.repo.claim("replacement", Date.now(), "prompt"))?.id,
      jobs[1].id,
    );
    // A late 429 from the previous key must not put the newly configured key on cooldown.
    provider.analyze = async () => {
      await f.workflows.updateSettings({
        promptApiKey: "rotated-during-request",
      });
      throw new ProviderError(
        "late limit",
        true,
        true,
        { status: 429, code: "RateLimitExceeded" },
        10000,
      );
    };
    await new Worker(f.workflows, provider, () => {}).step("prompt");
    await f.due();
    assert.ok(
      await f.workflows.repo.claim("new-key-unaffected", Date.now(), "prompt"),
    );
    await f.reopen();
    assert.ok(
      await f.workflows.repo.claim("after-restart", Date.now(), "prompt"),
    );
  } finally {
    await f.close();
  }
});

test("concurrent claims never execute the same job twice even without a concurrency cap", async () => {
  const f = await fixture();
  try {
    await seed(f.workflows, 1, "exclusive");
    const claims = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        f.workflows.repo.claim(`owner-${i}`),
      ),
    );
    assert.equal(claims.filter(Boolean).length, 1);
  } finally {
    await f.close();
  }
});
