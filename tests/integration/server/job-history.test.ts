import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture, pairs, loginHeaders } from "../../support/production.js";

test("job history paginates and filters in SQL, always newest first regardless of status", async () => {
  const f = await fixture();
  try {
    await f.workflows.enqueue(randomUUID(), pairs(f.product), "prompt-set");
    await f.db.transaction(async (tx) => {
      const original = (await f.workflows.repo.view(tx)).jobs[0];
      original.createdAt = 1;
      original.status = "running";
      await f.workflows.repo.saveJob(tx, original);
      for (let i = 0; i < 123; i++)
        await f.workflows.repo.insertJob(tx, {
          ...original,
          id: `history-${String(i).padStart(3, "0")}`,
          status: i % 2 ? "failed" : "completed",
          createdAt: 1000 + i,
          role: i === 0 ? "literal %_" : `历史 ${i}`,
          error: "",
        });
    });
    assert.equal(
      (await f.app.inject({ url: "/api/jobs/history" })).statusCode,
      401,
    );
    const headers = await loginHeaders(f.app);
    const read = async (query = "") => {
      const response = await f.app.inject({
        url: `/api/jobs/history${query}`,
        headers,
      });
      assert.equal(response.statusCode, 200);
      return response.json();
    };
    const first = await read(),
      second = await read("?page=2"),
      third = await read("?page=3");
    assert.equal(first.total, 124);
    assert.equal(first.pages, 3);
    assert.equal(first.jobs.length, 50);
    assert.equal(second.jobs.length, 50);
    assert.equal(third.jobs.length, 24);
    const all = [...first.jobs, ...second.jobs, ...third.jobs];
    assert.equal(new Set(all.map((job) => job.id)).size, 124);
    assert.ok(
      all.every(
        (job, index) =>
          index === 0 || job.createdAt <= all[index - 1].createdAt,
      ),
    );
    assert.equal(first.jobs[0].id, "history-122");
    assert.equal(third.jobs.at(-1).status, "running");
    const filtered = await read(
      "?status=attention&pageSize=10&search=" + encodeURIComponent("历史"),
    );
    assert.equal(filtered.jobs.length, 10);
    assert.ok(filtered.jobs.every((job: any) => job.status === "failed"));
    assert.equal((await read("?search=%25_")).total, 1);
    assert.equal((await read("?page=999")).page, 3);
    assert.equal((await read("?search=missing")).total, 0);
    for (const query of ["?page=0", "?pageSize=101", "?status=invalid"])
      assert.equal(
        (await f.app.inject({ url: `/api/jobs/history${query}`, headers }))
          .statusCode,
        400,
      );
  } finally {
    await f.close();
  }
});
