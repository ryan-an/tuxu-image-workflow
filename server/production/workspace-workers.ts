import { Worker } from "./worker.js";
import { GrsaiProvider } from "./provider.js";
import type { Workspaces } from "./workspaces.js";
import type { ExecutionLane } from "./execution-limits.js";
import type { Provider } from "./provider.js";
import type { Workflows } from "./workflows.js";

// Workers use the same immutable scopes as requests; one team's pause,
// concurrency, credentials and recovery never apply to another team's jobs.
export class WorkspaceWorkers {
  private workers = new Map<string, Worker>();
  private timer?: ReturnType<typeof setTimeout>;
  private dispatchTimer?: ReturnType<typeof setTimeout>;
  private cursor = 0;
  private active = { prompt: 0, submit: 0, query: 0 };
  private stopped = false;
  private refreshing: Promise<void> = Promise.resolve();
  constructor(
    private workspaces: Workspaces,
    private diagnostic: (event: unknown) => void,
    private providerDiagnostic = diagnostic,
    private providerFactory?: (workflows: Workflows) => Provider,
  ) {}
  private async refresh() {
    for (const workflows of await this.workspaces.all()) {
      if (this.stopped) return;
      const id = workflows.repo.workspaceId;
      if (this.workers.has(id)) continue;
      const worker = new Worker(
        workflows,
        this.providerFactory?.(workflows) ||
          new GrsaiProvider(workflows.assets, (event) =>
            this.providerDiagnostic({ workspaceId: id, ...event }),
          ),
        this.diagnostic,
      );
      this.workers.set(id, worker);
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
    const dispatch = () => {
      if (this.stopped) return;
      const entries = [...this.workers.entries()];
      if (entries.length) {
        const offset = this.cursor++ % entries.length;
        const ordered = [...entries.slice(offset), ...entries.slice(0, offset)];
        // Interleave workspaces rather than letting the first team fill every slot.
        for (const lane of ["prompt", "submit", "query"] as ExecutionLane[]) {
          const limit = ordered[0][1].limits[lane];
          let turns = 0;
          while (this.active[lane] < limit) {
            const worker = ordered[turns++ % ordered.length][1];
            this.active[lane]++;
            void worker.launch(lane).finally(() => this.active[lane]--);
          }
        }
      }
      this.dispatchTimer = setTimeout(dispatch, 1000);
    };
    dispatch();
  }
  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearTimeout(this.dispatchTimer);
    await this.refreshing;
    await Promise.all(
      [...this.workers.values()].map((worker) => worker.stop()),
    );
  }
}
