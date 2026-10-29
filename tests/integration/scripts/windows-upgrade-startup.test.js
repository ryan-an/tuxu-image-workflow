import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
const { artifactPath } = createRequire(import.meta.url)(
  resolve("tests/support/artifacts.cjs"),
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

test(
  "a previous Windows database updates to the current version and boots twice with accounts, sessions, settings and assets preserved",
  {
    skip:
      !process.env.TUXU_WINDOWS_PREVIOUS_BUNDLE ||
      !process.env.TUXU_WINDOWS_UPDATER,
    timeout: 180000,
  },
  async () => {
    const destination = artifactPath(`windows-upgrade-startup/${randomUUID()}`);
    await mkdir(destination, { recursive: true });
    const archive = resolve(process.env.TUXU_WINDOWS_PREVIOUS_BUNDLE);
    const updater = resolve(process.env.TUXU_WINDOWS_UPDATER);
    const currentVersion = JSON.parse(
      await readFile(resolve("package.json"), "utf8"),
    ).version;
    const extraction = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory($env:TUXU_PACKAGE_ARCHIVE, $env:TUXU_PACKAGE_DESTINATION)",
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        env: {
          ...process.env,
          TUXU_PACKAGE_ARCHIVE: archive,
          TUXU_PACKAGE_DESTINATION: destination,
        },
      },
    );
    assert.equal(extraction.status, 0, extraction.stderr);
    const root = join(destination, basename(archive, ".zip"));
    assert.notEqual(
      JSON.parse(await readFile(join(root, "manifest.json"), "utf8")).version,
      currentVersion,
    );
    const migrations = join(
      root,
      "build-server/server/production/sqlite-migrations",
    );
    for (const name of await readdir(migrations)) {
      if (!/^\d+\.sql$/.test(name)) continue;
      const path = join(migrations, name);
      await writeFile(
        path,
        (await readFile(path, "utf8"))
          .replace(/\r\n/g, "\n")
          .replace(/\n/g, "\r\n"),
      );
    }
    const socket = createServer();
    await new Promise((done) => socket.listen(0, "127.0.0.1", done));
    const port = socket.address().port;
    await new Promise((done) => socket.close(done));
    const origin = `http://127.0.0.1:${port}`;
    const config = `HOST=127.0.0.1\nPORT=${port}\nNODE_ENV=production\nREQUIRE_HTTPS=false\nDATABASE_PATH=./data/workspace.sqlite\nASSET_DIRECTORY=./data/assets\nAPP_PASSWORD=upgrade-test-password\nCREDENTIAL_SECRET=${"12".repeat(32)}\n`;
    await writeFile(join(root, ".env"), config);
    const node = join(root, "runtime/node.exe");
    const seed = spawnSync(
      node,
      [
        "--input-type=module",
        "-e",
        `
    import { database, migrate } from './build-server/server/production/database.js';
    import { createApp } from './build-server/server/production/app.js';
    import { newProduct } from './build-server/shared/model.js';
    const db = database('data/workspace.sqlite'); await migrate(db);
    const { app, workflows } = await createApp({ db, assetDirectory: 'data/assets', credentialSecret: '${"12".repeat(32)}', password: 'upgrade-test-password', logger: false });
    try {
      await workflows.updateSettings({ apiKey: 'upgrade-image-key', promptApiKey: 'upgrade-prompt-key' });
      const state = await workflows.repo.view();
      await workflows.edit([{ path: ['common'], before: state.common, value: 'preserved upgrade rules' }]);
      const product = newProduct('UPGRADE-01', 'preserved product');
      await workflows.repo.saveProduct(db, product);
      const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'upgrade-test-password' } });
      if (login.statusCode !== 200) throw new Error(login.body);
      console.log('FIXTURE:' + JSON.stringify({ productId: product.id, cookie: String(login.headers['set-cookie']).split(';')[0], migrations: (await db.query('SELECT * FROM schema_migrations ORDER BY version')).rows }));
    } finally { await app.close(); await db.close(); }
  `,
      ],
      { cwd: root, encoding: "utf8", windowsHide: true },
    );
    assert.equal(seed.status, 0, seed.stdout + seed.stderr);
    const fixture = JSON.parse(
      seed.stdout
        .split(/\r?\n/)
        .find((line) => line.startsWith("FIXTURE:"))
        .slice(8),
    );
    const firstMigration = await readFile(join(migrations, "001.sql"), "utf8");
    assert.ok(
      [
        hash(firstMigration),
        hash(firstMigration.replace(/\r\n/g, "\n")),
      ].includes(fixture.migrations[0].checksum),
    );
    await mkdir(join(root, "data/assets"), { recursive: true });
    await writeFile(
      join(root, "data/assets/preserved.bin"),
      "original asset bytes",
    );
    const databasePath = join(root, "data/workspace.sqlite");
    const originalDatabase = hash(await readFile(databasePath));
    const update = spawnSync(updater, ["--target", root, "--noninteractive"], {
      cwd: destination,
      encoding: "utf8",
      windowsHide: true,
      timeout: 90000,
    });
    assert.equal(update.status, 0, update.stdout + update.stderr);
    assert.equal(
      JSON.parse(await readFile(join(root, "manifest.json"), "utf8")).version,
      currentVersion,
    );
    assert.equal(
      JSON.parse(await readFile(join(root, "package.json"), "utf8")).version,
      currentVersion,
    );
    assert.equal(
      hash(await readFile(databasePath)),
      originalDatabase,
      "The updater preserves the original database before startup migrations",
    );
    assert.equal(await readFile(join(root, ".env"), "utf8"), config);
    await assert.rejects(access(join(root, "第三方许可")), { code: "ENOENT" });
    const snapshot = (await readdir(join(root, "data/backups"))).find((name) =>
      name.startsWith("update-"),
    );
    assert.ok(snapshot);
    assert.equal(
      hash(
        await readFile(
          join(root, "data/backups", snapshot, "data/workspace.sqlite"),
        ),
      ),
      originalDatabase,
    );
    let child;
    let logs = "";
    const stop = async () => {
      if (!child || child.exitCode !== null) return;
      const finished = once(child, "exit");
      child.stdin.end("stop\n");
      const [code] = await Promise.race([
        finished,
        delay(15000, undefined, { ref: false }).then(() => {
          throw new Error("Updated service did not stop");
        }),
      ]);
      assert.equal(code, 0, logs);
    };
    try {
      for (let restart = 0; restart < 2; restart++) {
        child = spawn(join(root, "图序.exe"), ["--noninteractive"], {
          cwd: destination,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        });
        child.stdout.on("data", (chunk) => {
          logs += chunk;
        });
        child.stderr.on("data", (chunk) => {
          logs += chunk;
        });
        let ready = false;
        for (let attempt = 0; attempt < 150; attempt++) {
          if (child.exitCode !== null) throw new Error(logs);
          try {
            if ((await fetch(`${origin}/health`)).ok) {
              ready = true;
              break;
            }
          } catch {}
          await delay(100);
        }
        assert.ok(ready, logs);
        assert.equal(
          (await (await fetch(`${origin}/version.json`)).json()).version,
          currentVersion,
        );
        const headers = { cookie: fixture.cookie, origin };
        const response = await fetch(`${origin}/api/workspace`, { headers });
        assert.equal(response.status, 200, await response.clone().text());
        const state = await response.json();
        assert.equal(state.common, "preserved upgrade rules");
        assert.equal(
          state.products.find((product) => product.id === fixture.productId)
            .name,
          "preserved product",
        );
        const settings = await (
          await fetch(`${origin}/api/workflow/settings`, { headers })
        ).json();
        assert.equal(settings.hasKey, true);
        assert.equal(settings.hasPromptKey, true);
        const login = await fetch(`${origin}/api/auth/login`, {
          method: "POST",
          headers: { "content-type": "application/json", origin },
          body: JSON.stringify({
            username: "admin",
            password: "upgrade-test-password",
          }),
        });
        assert.equal(login.status, 200);
        await stop();
      }
      const history = spawnSync(
        node,
        [
          "--input-type=module",
          "-e",
          `
      import { database } from './build-server/server/production/database.js';
      import { createApp } from './build-server/server/production/app.js';
      const db = database('data/workspace.sqlite');
      const { app, workflows } = await createApp({ db, assetDirectory: 'data/assets', credentialSecret: '${"12".repeat(32)}', password: 'upgrade-test-password', logger: false });
      try {
        if (await workflows.key() !== 'upgrade-image-key' || await workflows.key('doubao') !== 'upgrade-prompt-key') throw new Error('Existing encrypted credentials cannot be decrypted');
        console.log('HISTORY:' + JSON.stringify((await db.query("SELECT * FROM schema_migrations ORDER BY version")).rows));
        await db.query("UPDATE schema_migrations SET checksum='genuine-mismatch' WHERE version='001.sql'");
      } finally { await app.close(); await db.close(); }
    `,
        ],
        { cwd: root, encoding: "utf8", windowsHide: true },
      );
      assert.equal(history.status, 0, history.stdout + history.stderr);
      const originalVersions = new Set(
        fixture.migrations.map((row) => row.version),
      );
      assert.deepEqual(
        JSON.parse(
          history.stdout
            .split(/\r?\n/)
            .find((line) => line.startsWith("HISTORY:"))
            .slice(8),
        ).filter((row) => originalVersions.has(row.version)),
        fixture.migrations,
      );
      const rejected = spawnSync(join(root, "图序.exe"), ["--noninteractive"], {
        cwd: destination,
        encoding: "utf8",
        windowsHide: true,
        timeout: 15000,
        input: "stop\n",
      });
      assert.notEqual(rejected.status, 0);
      assert.match(
        rejected.stderr,
        /数据库升级失败：已执行迁移 001.sql 内容发生变化/,
      );
      assert.doesNotMatch(rejected.stderr, /file:\/\/\/|throw new Error/);
      assert.equal(await readFile(join(root, ".env"), "utf8"), config);
      assert.equal(
        await readFile(join(root, "data/assets/preserved.bin"), "utf8"),
        "original asset bytes",
      );
    } finally {
      await stop();
      await writeFile(join(destination, "startup.log"), logs);
      await writeFile(
        join(destination, "update.log"),
        update.stdout + update.stderr,
      );
    }
  },
);
