import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  fixture,
  password,
  pairs,
  fakeProvider,
  counts,
} from "../../support/production.js";
import { Members } from "../../../server/production/members.js";
import { Worker } from "../../../server/production/worker.js";

test("two editors share a single card task and both receive its platform progress", async () => {
  const f = await fixture();
  try {
    const headers: { cookie: string }[] = [];
    for (const name of ["image-a", "image-b"]) {
      await new Members(f.db).create({
        username: name,
        displayName: name,
        password,
        role: "editor",
        monthlyLimit: null,
      });
      const login = await f.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { username: name, password },
      });
      assert.equal(login.statusCode, 200, login.body);
      headers.push({
        cookie: String(login.headers["set-cookie"]).split(";")[0],
      });
    }
    await f.workflows.edit([
      {
        path: [
          "products",
          f.product.id,
          "tasks",
          f.product.tasks[0].id,
          "prompt",
        ],
        before: "",
        value: "协作生图提示词",
      },
    ]);
    const cursor = await f.workflows.repo.cursor();
    const submitted = await Promise.all(
      headers.map((header) =>
        f.app.inject({
          method: "POST",
          url: "/api/jobs",
          headers: header,
          payload: {
            commandId: randomUUID(),
            kind: "image",
            pairs: pairs(f.product).slice(0, 1),
          },
        }),
      ),
    );
    assert.ok(submitted.every((response) => response.statusCode === 200));
    assert.deepEqual(
      submitted.map((response) => response.json().count).sort(),
      [0, 1],
    );
    const calls = counts();
    const provider = fakeProvider(calls);
    provider.query = async () => {
      calls.query++;
      return { status: "running", progress: 46 };
    };
    const worker = new Worker(f.workflows, provider);
    for (let i = 0; i < 2; i++) {
      await f.due();
      assert.equal(await worker.step(), true);
    }
    const jobs = (await f.workflows.repo.view()).jobs;
    assert.equal(jobs.length, 1);
    const job = jobs[0];
    assert.ok(["image-a", "image-b"].includes(job.createdBy!.username));
    for (const header of headers) {
      for (const url of [
        "/api/workspace/startup",
        `/api/workspace/changes?since=${cursor}`,
        "/api/jobs/history?page=1&pageSize=50&status=all&search=",
      ]) {
        const response = await f.app.inject({
          url,
          headers: {
            ...header,
            "x-workspace-view": "compact",
            "x-workspace-products": JSON.stringify([f.product.id]),
          },
        });
        assert.equal(response.statusCode, 200, response.body);
        const visible = response.json().jobs;
        assert.equal(visible.length, 1);
        assert.equal(visible[0].id, job.id);
        assert.equal(visible[0].remoteId, "remote-1");
        assert.equal(visible[0].progress, 46);
        assert.deepEqual(visible[0].createdBy, job.createdBy);
      }
    }
    assert.deepEqual(calls, { analyze: 0, submit: 1, query: 1 });
  } finally {
    await f.close();
  }
});
