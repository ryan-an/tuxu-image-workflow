import { Worker } from "./worker.js";
import { GrsaiProvider } from "./provider.js";
import type { Workspaces } from "./workspaces.js";

// Workers use the same immutable scopes as requests; one team's pause,
// concurrency, credentials and recovery never apply to another team's jobs.
export class WorkspaceWorkers {
  private workers = new Map<string, Worker>();
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private refreshing: Promise<void> = Promise.resolve();
  constructor(
    private workspaces: Workspaces,
    private diagnostic: (event: unknown) => void,
    private providerDiagnostic = diagnostic,
  ) {}
  private async refresh() {
    for (const workflows of await this.workspaces.all()) {
      if (this.stopped) return;
      const id = workflows.repo.workspaceId;
      if (this.workers.has(id)) continue;
      const worker = new Worker(
        workflows,
        new GrsaiProvider(workflows.assets, (event) =>
          this.providerDiagnostic({ workspaceId: id, ...event }),
        ),
        this.diagnostic,
      );
      this.workers.set(id, worker);
      worker.start();
    }
  }
  async start() {
    const tick = () => {
      if (this.stopped) return;
      this.refreshing = this.refresh()
        .catch(this.diagnostic)
        .finally(() => {
          if (!this.stopped) this.timer = setTimeout(tick, 5000);
        });
    };
    tick();
    await this.refreshing;
  }
  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.refreshing;
    await Promise.all(
      [...this.workers.values()].map((worker) => worker.stop()),
    );
  }
}
