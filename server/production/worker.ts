import { randomUUID } from "node:crypto";
import { productPhotos } from "../../shared/prompt-suite.js";
import { savePrompt, selectVersion } from "../../shared/model.js";
import { ProviderError, type Provider } from "./provider.js";
import type { Workflows } from "./workflows.js";
import type { Job } from "./types.js";
import { stageTimeout } from "./execution-limits.js";
import { streamedPrompts } from "../../shared/streamed-prompts.js";
export class Worker {
  private owner = randomUUID();
  private stopped = false;
  private timer?: ReturnType<typeof setTimeout>;
  private tasks = new Set<Promise<void>>();
  private controllers = new Set<AbortController>();
  constructor(
    private workflows: Workflows,
    private provider: Provider,
    private log: (error: unknown) => void = console.error,
  ) {}
  async step(): Promise<boolean> {
    const job = await this.workflows.repo.claim(this.owner);
    if (!job) return false;
    if (this.stopped) {
      await this.workflows.repo.updateClaim(
        job,
        async (_tx, _state, current) => {
          if (current.status !== "cancelled") current.status = "queued";
        },
      );
      return false;
    }
    const controller = new AbortController();
    const stageStarted = Date.now();
    this.controllers.add(controller);
    const cancel = (id: string) => {
      if (id === job.id) controller.abort();
    };
    this.workflows.analysisEvents.on("cancel", cancel);
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(stageTimeout(job.kind)),
    ]);
    let key = "";
    try {
      key = await this.workflows.key(
        job.kind === "prompt-set" && job.config.promptProvider === "doubao"
          ? "doubao"
          : "image",
      );
      if (job.kind === "prompt-set") {
        if (!(await this.workflows.repo.markStage(job, "analyzing")))
          return true;
        let lastProgress = 0;
        const targets = job.productSnapshot!.tasks.filter(
          (t) => !job.taskIds || job.taskIds.includes(t.id),
        );
        const snapshot = { ...job.productSnapshot!, tasks: targets };
        const result = await this.provider.analyze(
          snapshot,
          job.common!,
          job.config,
          key,
          signal,
          async (text, final) => {
            if (!final && Date.now() - lastProgress < 300) return;
            lastProgress = Date.now();
            const drafts = Object.fromEntries(
              Object.entries(streamedPrompts(text)).filter(([role]) =>
                targets.some((t) => t.role === role),
              ),
            );
            if (
              await this.workflows.repo.saveAnalysisProgress(
                job,
                drafts,
                text.length,
                final ? text : undefined,
              )
            )
              this.workflows.analysisEvents.publish({
                id: job.id,
                drafts,
                receivedChars: text.length,
              });
          },
        );
        if (
          !Array.isArray(result.prompts) ||
          result.prompts.length !== targets.length ||
          new Set(result.prompts.map((p: any) => p.role)).size !==
            targets.length ||
          targets.some(
            (t) =>
              !result.prompts.some(
                (p: any) =>
                  p.role === t.role &&
                  typeof p.prompt === "string" &&
                  p.prompt.trim(),
              ),
          )
        )
          throw new ProviderError(
            "所选卡片分析结果缺失，已阻止生图",
            false,
            true,
          );
        await this.workflows.repo.updateClaim(
          job,
          async (tx, state, current) => {
            if (current.status === "cancelled") return;
            const product = state.products.find((p) => p.id === job.productId)!;
            const set = {
              id: job.id,
              createdAt: Date.now(),
              style: result.style,
              prompts: result.prompts,
            };
            if (!product.promptSets.some((s) => s.id === job.id))
              product.promptSets.push(set);
            for (const task of product.tasks.filter((t) =>
              targets.some((target) => target.id === t.id),
            )) {
              const item = result.prompts.find(
                (p: any) => p.role === task.role,
              );
              if (task.revision === job.revisions![task.id]) {
                savePrompt(task, item.prompt);
                task.promptSetId = job.id;
                task.realPhotoIndices = item.photoIndices;
              } else
                task.promptHistory.push({
                  prompt: item.prompt,
                  createdAt: set.createdAt,
                  setId: job.id,
                });
            }
            current.prompts = result.prompts;
            delete current.promptWarnings;
            current.error = "";
            delete current.validationError;
            current.status = "completed";
            current.stage = "completed";
            current.finishedAt = Date.now();
            await this.workflows.repo.saveProduct(tx, product);
          },
        );
        const saved = (await this.workflows.repo.view()).jobs.find(
          (item) => item.id === job.id,
        );
        if (saved?.status === "completed")
          this.log({
            event: "prompt.completed",
            jobId: job.id,
            promptCount: result.prompts.length,
            elapsedMs: Date.now() - stageStarted,
          });
      } else if (!job.remoteId) {
        let prompt = job.prompt!,
          photos = job.referenceImages!;
        if (job.dependsOn) {
          const state = await this.workflows.repo.view(),
            set = state.jobs.find((j) => j.id === job.dependsOn)!;
          const item = set.prompts!.find((p: any) => p.role === job.role),
            all = productPhotos(set.productSnapshot!);
          prompt = item.prompt;
          photos = item.photoIndices?.length
            ? item.photoIndices.map((i: number) => all[i]).filter(Boolean)
            : all;
        }
        // Persist the uncertain-submission boundary BEFORE making the paid request.
        if (!(await this.workflows.repo.markStage(job, "submitting")))
          return true;
        const result = await this.provider.submit(
          prompt,
          photos,
          job.config,
          key,
          signal,
        );
        await this.workflows.repo.updateClaim(
          job,
          async (_tx, _state, current) => {
            current.remoteId = result.id;
            current.prompt = prompt;
            current.referenceImages = photos;
            current.stage = "polling";
            if (current.status !== "cancelled") current.status = "queued";
            return 2500;
          },
        );
      } else {
        const result = await this.provider.query(
          job.remoteId,
          job.config,
          key,
          signal,
        );
        if (result.status !== "succeeded") {
          await this.workflows.repo.updateClaim(
            job,
            async (_tx, _state, current) => {
              current.progress = result.progress || 0;
              current.failures = 0;
              if (current.status !== "cancelled") current.status = "queued";
              return 2500;
            },
          );
        } else {
          if (!result.source) throw new ProviderError("结果地址缺失", true);
          const source = await this.workflows.assets.download(
            result.source,
            signal,
          );
          await this.workflows.repo.updateClaim(
            job,
            async (tx, state, current) => {
              if (current.status === "cancelled") return;
              const product = state.products.find(
                (p) => p.id === job.productId,
              )!;
              const task = product.tasks.find((t) => t.id === job.taskId)!;
              if (!task.versions.some((v) => v.jobId === job.id)) {
                const version = {
                  id: randomUUID(),
                  jobId: job.id,
                  source,
                  prompt: current.prompt,
                  origin: "generated",
                  createdAt: Date.now(),
                  number: task.versions.length + 1,
                };
                task.versions.push(version);
                selectVersion(task, version.id, true);
              }
              current.status = "completed";
              current.stage = "completed";
              current.progress = 100;
              current.finishedAt = Date.now();
              await this.workflows.repo.saveProduct(tx, product);
            },
          );
        }
      }
    } catch (error) {
      const rawCode = (error as any)?.cause?.code || (error as any)?.code;
      const transportCode =
        typeof rawCode === "string" && /^[A-Z0-9_]{1,80}$/.test(rawCode)
          ? rawCode
          : undefined;
      if (!controller.signal.aborted)
        this.log({
          event: "task.failed",
          jobId: job.id,
          kind: job.kind,
          stage: job.stage,
          model:
            job.kind === "prompt-set"
              ? job.config.promptModel
              : job.config.imageModel,
          elapsedMs: Date.now() - stageStarted,
          errorType: error instanceof Error ? error.name : "Error",
          transportCode,
          receivedChars:
            this.workflows.analysisEvents.latest.get(job.id)?.receivedChars ||
            0,
          validation:
            error instanceof ProviderError ? error.validation : undefined,
          upstream: error instanceof ProviderError ? error.upstream : undefined,
        });
      // If this write fails, the lease remains and the next worker recovers it.
      await this.workflows.repo.updateClaim(
        job,
        async (_tx, _state, current) => {
          if (current.status === "cancelled") return;
          const message = error instanceof Error ? error.message : "执行失败";
          current.error = key ? message.replaceAll(key, "[已隐藏]") : message;
          current.validationError =
            error instanceof ProviderError ? error.validation : undefined;
          if (transportCode) current.error += ` (${transportCode})`;
          current.failures = (current.failures || 0) + 1;
          if (
            !current.remoteId &&
            ["submitting", "analyzing"].includes(current.stage)
          ) {
            const definitive =
              error instanceof ProviderError && error.definitive;
            current.status = definitive ? "failed" : "interrupted";
            if (definitive) current.stage = "pending";
            else current.error += "；平台受理状态未知，请核对后处理";
          } else if (
            current.remoteId &&
            !(error instanceof ProviderError && error.definitive) &&
            current.failures < 5
          )
            current.status = "queued";
          else current.status = "failed";
          if (["failed", "interrupted"].includes(current.status))
            current.finishedAt = Date.now();
          return Math.min(60000, 1000 * 2 ** current.failures);
        },
      );
    } finally {
      this.workflows.analysisEvents.off("cancel", cancel);
      this.controllers.delete(controller);
      if (job.kind === "prompt-set") {
        const current = (await this.workflows.repo.view()).jobs.find(
          (item) => item.id === job.id,
        );
        this.workflows.analysisEvents.publish({
          id: job.id,
          finished: true,
          status: current?.status,
          error: current?.error,
        });
      }
    }
    return true;
  }
  start() {
    // Use parallel steps; each step finishes one durable stage, not the entire job.
    const dispatch = () => {
      if (this.stopped) return;
      while (this.tasks.size < 6) {
        const task = this.step()
          .then(() => {})
          .catch(this.log);
        this.tasks.add(task);
        void task.finally(() => this.tasks.delete(task));
      }
      this.timer = setTimeout(dispatch, 1000);
    };
    dispatch();
  }
  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    for (const controller of this.controllers) controller.abort();
    await Promise.allSettled([...this.tasks]);
  }
}
