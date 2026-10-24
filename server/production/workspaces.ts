import { Repository, WORKSPACE } from "./repository.js";
import { Assets } from "./assets.js";
import { Credentials } from "./credentials.js";
import { Workflows } from "./workflows.js";
import { AppError, type Database } from "./types.js";

// A runtime has an immutable workspace scope, shared by its HTTP handlers,
// assistant streams and worker. Never derive this scope from a request body.
export class Workspaces {
  private instances = new Map<string, Workflows>();
  private pending = new Map<string, Promise<Workflows>>();
  constructor(
    private db: Database,
    private assetsDirectory: string,
    private secret: string,
  ) {}
  async get(id: string) {
    if (this.instances.has(id)) return this.instances.get(id)!;
    if (this.pending.has(id)) return this.pending.get(id)!;
    const work = (async () => {
      if (
        !(await this.db.query("SELECT id FROM workspace WHERE id=$1", [id]))
          .rows.length
      )
        throw new AppError("工作区不存在", 404);
      const repo = new Repository(this.db, id);
      await repo.initialize();
      const workflows = new Workflows(
        repo,
        new Assets(this.db, this.assetsDirectory, id),
        new Credentials(this.secret),
      );
      this.instances.set(id, workflows);
      return workflows;
    })();
    this.pending.set(id, work);
    try {
      return await work;
    } finally {
      this.pending.delete(id);
    }
  }
  async all() {
    const rows = await this.db.query(
      "SELECT id FROM workspace WHERE archived_at IS NULL ORDER BY id",
    );
    return Promise.all(rows.rows.map((row) => this.get(row.id)));
  }
  async initialize() {
    await new Repository(this.db, WORKSPACE).initialize();
    return this.get(WORKSPACE);
  }
}
