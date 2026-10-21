import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import { database, migrate } from "../../server/production/database.js";
import { createApp } from "../../server/production/app.js";
import { newProduct } from "../../shared/model.js";
import { editable, differences } from "../../shared/workspace-edits.js";
import type { Product } from "../../server/production/types.js";
import type { Provider } from "../../server/production/provider.js";
export const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
export const password = "test-password-123456789",
  secret = "12".repeat(32);
export async function loginHeaders(
  app: Awaited<ReturnType<typeof createApp>>["app"],
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: "admin", password },
  });
  if (response.statusCode !== 200) throw new Error("测试登录失败");
  return { cookie: String(response.headers["set-cookie"]).split(";")[0] };
}
export async function fixture(staticDirectory?: string) {
  const directory = await mkdtemp(join(tmpdir(), "tuxu-sqlite-"));
  const filename = join(directory, "workspace.sqlite");
  let db = database(filename);
  await migrate(db);
  const options = {
    db,
    assetDirectory: join(directory, "assets"),
    credentialSecret: secret,
    password,
    logger: false,
    staticDirectory,
  };
  let { app, workflows } = await createApp(options);
  await workflows.updateSettings({
    apiKey: "fake-platform-key",
    promptApiKey: "fake-doubao-key",
  });
  const product = newProduct(
    "TEST-01",
    "真实产品",
    "品牌：Test；尺寸：24×28cm；25个装",
  ) as Product;
  product.photo = png;
  product.photos = [png];
  product.tasks.forEach((t) => (t.references = [png]));
  const empty = await workflows.repo.view(),
    newState = structuredClone(empty);
  newState.products.push(product);
  await workflows.edit(differences(editable(empty), editable(newState)));
  const state = await workflows.repo.view();
  return {
    get app() {
      return app;
    },
    get db() {
      return db;
    },
    get workflows() {
      return workflows;
    },
    filename,
    product: state.products[0],
    close: async () => {
      await app.close();
      await db.close();
      if (
        dirname(resolve(directory)) !== resolve(tmpdir()) ||
        !basename(directory).startsWith("tuxu-sqlite-")
      )
        throw new Error("拒绝清理非测试目录");
      await rm(directory, { recursive: true, force: true });
    },
    reopen: async () => {
      await app.close();
      await db.close();
      db = database(filename);
      await migrate(db);
      ({ app, workflows } = await createApp({ ...options, db }));
    },
    due: () =>
      db.query("UPDATE jobs SET due_at=$1 WHERE status='queued'", [Date.now()]),
  };
}
export function fakeProvider(calls: {
  submit: number;
  query: number;
  analyze: number;
}): Provider {
  return {
    async analyze(product) {
      calls.analyze++;
      return {
        style: "uniform",
        prompts: product.tasks.map(({ role }) => ({
          role,
          prompt: `prompt:${role}`,
          photoIndices: [0],
        })),
      };
    },
    async submit() {
      calls.submit++;
      return { id: `remote-${calls.submit}` };
    },
    async query() {
      calls.query++;
      return { status: "succeeded", source: png };
    },
  };
}
export const counts = () => ({ submit: 0, query: 0, analyze: 0 });
export const pairs = (p: Product) =>
  p.tasks.map((t) => ({ productId: p.id, taskId: t.id }));
