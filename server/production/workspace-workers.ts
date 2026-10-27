import { Worker } from "./worker.js";
import { GrsaiProvider } from "./provider.js";
import type { Workspaces } from "./workspaces.js";
import type { Provider } from "./provider.js";
import type { Workflows } from "./workflows.js";

// Workers use the same immutable scopes as requests; one team's pause,
// credentials and recovery never apply to another team's jobs.
export class WorkspaceWorkers {
  private workers = new Map<string, Worker>();
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private refreshing: Promise<void> = Promise.resolve();
  constructor(
    private workspaces: Workspaces,
    private diagnostic: (event: unknown) => void,
    private providerDiagnostic = diagnostic,
    private providerFactory?: (workflows: Workflows) => Provider,
  ) {}
  private async refresh() {
    for (const workflows of await this.workspaces.ready()) {
      if (this.stopped) return;
      const id = workflows.repo.workspaceId;
      let worker = this.workers.get(id);
      if (!worker) {
        worker = new Worker(
          workflows,
          this.providerFactory?.(workflows) ||
            new GrsaiProvider(workflows.assets, (event) =>
              this.providerDiagnostic({ workspaceId: id, ...event }),
            ),
          this.diagnostic,
        );
        this.workers.set(id, worker);
      }
      void worker.dispatch();
    }
  }
  async start() {
    const tick = () => {
      if (this.stopped) return;
      this.refreshing = this.refresh()
        .catch(this.diagnostic)
        .finally(() => {
          if (!this.stopped) this.timer = setTimeout(tick, 1000);
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
