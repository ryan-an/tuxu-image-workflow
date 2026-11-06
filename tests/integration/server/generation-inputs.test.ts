import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { editable, differences } from "../../../shared/workspace-edits.js";
import {
  GrsaiProvider,
  type Provider,
} from "../../../server/production/provider.js";
import { Worker } from "../../../server/production/worker.js";
import { fixture, pairs, png, loginHeaders } from "../../support/production.js";

for (const withPhotos of [false, true])
  for (const kind of [
    "prompt",
    "prompt-set",
    "image",
    "workflow",
    "full-workflow",
  ])
    test(`${kind} ${withPhotos ? "uses all real photos despite selected indices" : "uses all references with the current card labelled"} and freezes image inputs across restart`, async (t) => {
      const f = await fixture();
      try {
        const otherImage = await f.workflows.assets.put(
          await sharp({
            create: { width: 2, height: 2, channels: 3, background: "orange" },
          })
            .png()
            .toBuffer(),
          "image/png",
        );
        const realPhotos = [f.product.photo, otherImage];
        if (withPhotos)
          for (const background of ["red", "green", "blue", "purple"])
            realPhotos.push(
              await f.workflows.assets.put(
                await sharp({
                  create: { width: 2, height: 2, channels: 3, background },
                })
                  .png()
                  .toBuffer(),
                "image/png",
              ),
            );
        const before = await f.workflows.repo.view(),
          draft = structuredClone(before),
          product = draft.products[0];
        product.photo = withPhotos ? f.product.photo : "";
        product.photos = withPhotos ? realPhotos : [];
        product.tasks.forEach((task, index) => {
          task.references =
            index === 2
              ? []
              : index === 1
                ? [otherImage, f.product.photo, otherImage]
                : [index % 2 ? otherImage : f.product.photo];
          if (kind === "image") task.prompt = `已有提示词：${task.role}`;
        });
        await f.workflows.edit(differences(editable(before), editable(draft)));
        const prepared = (await f.workflows.repo.view()).products[0];
        prepared.tasks.forEach((task) => {
          task.realPhotoIndices = [1];
        });
        await f.workflows.repo.saveProduct(f.db, prepared);
        const targets =
          kind === "prompt-set" || kind === "full-workflow"
            ? pairs(product)
            : pairs(product).slice(1, 2);
        const response = await f.app.inject({
          method: "POST",
          url: "/api/jobs",
          headers: await loginHeaders(f.app),
          payload: { commandId: randomUUID(), pairs: targets, kind },
        });
        assert.equal(response.statusCode, 200, response.body);
        const promptOnly = kind === "prompt" || kind === "prompt-set",
          analysisCount = kind === "image" ? 0 : 1,
          imageCount = promptOnly ? 0 : targets.length;
        assert.equal(response.json().count, analysisCount + imageCount);

        // Later uploads and reference edits must not replace queued inputs.
        const queued = await f.workflows.repo.view(),
          changed = structuredClone(queued);
        changed.products[0].photo = otherImage;
        changed.products[0].photos = [otherImage];
        changed.products[0].tasks.forEach((task) => {
          task.references = [];
        });
        await f.workflows.edit(
          differences(editable(queued), editable(changed)),
        );
        await f.reopen();

        const requests: any[] = [];
        t.mock.method(globalThis, "fetch", async (_url: any, options: any) => {
          requests.push(JSON.parse(options.body));
          return Response.json({ id: `remote-${requests.length}` });
        });
        const provider: Provider = new GrsaiProvider(f.workflows.assets);
        provider.analyze = async (snapshot) => {
          assert.equal(snapshot.photo, product.photo);
          assert.deepEqual(snapshot.photos, product.photos);
          assert.deepEqual(
            snapshot.tasks.map((task) => task.references),
            product.tasks
              .filter((task) => targets.some((pair) => pair.taskId === task.id))
              .map((task) => task.references),
          );
          return {
            style: "AI 风格",
            prompts: snapshot.tasks.map((task) => ({
              role: task.role,
              prompt: `AI 提示词：${task.role}`,
              photoIndices: withPhotos ? [1] : [],
            })),
          };
        };
        provider.query = async () => ({ status: "succeeded", source: png });
        const worker = new Worker(f.workflows, provider, () => {});
        for (let index = 0; index < analysisCount + imageCount * 2; index++) {
          await f.due();
          assert.equal(await worker.step(), true);
        }
        const saved = await f.workflows.repo.view();
        assert.ok(saved.jobs.every((job) => job.status === "completed"));
        assert.equal(requests.length, imageCount);
        for (const { taskId } of targets) {
          const original = product.tasks.find((task) => task.id === taskId)!,
            task = saved.products[0].tasks.find((task) => task.id === taskId)!,
            prompt =
              kind === "image" ? original.prompt : `AI 提示词：${task.role}`;
          if (kind !== "image" && original.references.length) {
            assert.equal(task.prompt, original.prompt);
            assert.equal(task.promptHistory.at(-1)?.prompt, prompt);
          } else assert.equal(task.prompt, prompt);
          if (promptOnly) continue;
          const sources = withPhotos
              ? realPhotos
              : [f.product.photo, otherImage],
            request = requests.find((item) => item.prompt.endsWith(prompt)),
            job = saved.jobs.find((item) => item.taskId === taskId)!;
          assert.ok(request);
          assert.deepEqual(
            request.images,
            await Promise.all(
              sources.map((source) =>
                f.workflows.assets.providerSource(source),
              ),
            ),
          );
          if (!withPhotos && sources.length) {
            assert.match(request.prompt, /参考图／对标图，不是产品实拍图/);
            assert.ok(request.prompt.includes(`本次只生成「${task.role}」`));
            assert.ok(request.prompt.includes("尺寸图：图片 1"));
            assert.ok(request.prompt.includes("卖点图：图片 2、图片 1"));
            if (original.references.length)
              assert.ok(
                request.prompt.includes(
                  `当前要做的对标图：${original.role === "卖点图" ? "图片 2、图片 1" : original.references[0] === otherImage ? "图片 2" : "图片 1"}（${task.role}）`,
                ),
              );
            else
              assert.ok(
                request.prompt.includes(`当前卡片「${task.role}」未提供对标图`),
              );
            assert.ok(request.prompt.includes(job.referenceImageContext));
          } else {
            assert.equal(request.prompt, prompt);
            assert.equal(job.referenceImageContext, undefined);
          }
          assert.equal(job.prompt, prompt);
          assert.equal(
            job.referenceImageKind,
            withPhotos ? "product-photo" : "reference",
          );
          assert.deepEqual(job.referenceImages, sources);
          assert.equal(task.versions[0].prompt, prompt);
        }
      } finally {
        await f.close();
      }
    });
