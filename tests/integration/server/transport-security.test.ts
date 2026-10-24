import test from "node:test";
import assert from "node:assert/strict";
import { get, request } from "node:https";
import type { AddressInfo } from "node:net";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { parseEnv, promisify } from "node:util";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { fixture, password } from "../../support/production.js";
import { loadTransportSecurity } from "../../../server/production/transport-security.js";
import { createLocalCertificate } from "../../../scripts/https-certificate.mjs";

test("HTTPS setup preserves account secrets, configures certificate paths and never overwrites an existing CA", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tuxu-https-setup-"));
  try {
    await mkdir(join(directory, "scripts"));
    for (const filename of [
      "setup-https.mjs",
      "setup-local.mjs",
      "https-certificate.mjs",
    ])
      await copyFile(
        resolve("scripts", filename),
        join(directory, "scripts", filename),
      );
    const existingPassword = "existing-password-do-not-log",
      existingSecret = "cd".repeat(32);
    const envPath = join(directory, ".env");
    await writeFile(
      envPath,
      `APP_PASSWORD=${existingPassword}\nCREDENTIAL_SECRET=${existingSecret}\nHOST=127.0.0.1\nPORT=3001\n`,
    );
    const execute = promisify(execFile);
    const result = await execute(
      process.execPath,
      [join(directory, "scripts/setup-https.mjs")],
      { cwd: directory, windowsHide: true },
    );
    assert.match(result.stdout, /https:\/\/127\.0\.0\.1:3001/);
    assert.ok(!result.stdout.includes(existingPassword));
    assert.ok(!result.stdout.includes(existingSecret));
    const updated = await readFile(envPath, "utf8"),
      config = parseEnv(updated);
    assert.equal(config.APP_PASSWORD, existingPassword);
    assert.equal(config.CREDENTIAL_SECRET, existingSecret);
    assert.ok(config.TLS_CERT_FILE);
    assert.ok(config.TLS_KEY_FILE);
    assert.ok(config.TLS_CA_FILE);
    assert.equal(
      config.HOST,
      "127.0.0.1",
      "setup must not expose a network listener",
    );
    const transport = await loadTransportSecurity({
      TLS_CERT_FILE: resolve(directory, config.TLS_CERT_FILE),
      TLS_KEY_FILE: resolve(directory, config.TLS_KEY_FILE),
    });
    assert.ok(transport.https?.cert);
    assert.ok(await readFile(resolve(directory, config.TLS_CA_FILE)));
    const certificate = await readFile(
      resolve(directory, config.TLS_CERT_FILE),
    );
    await assert.rejects(
      execute(process.execPath, [join(directory, "scripts/setup-https.mjs")], {
        cwd: directory,
        windowsHide: true,
      }),
      /已有 TLS 配置/,
    );
    assert.equal(await readFile(envPath, "utf8"), updated);
    assert.deepEqual(
      await readFile(resolve(directory, config.TLS_CERT_FILE)),
      certificate,
    );
    const startup = await execute(
      process.execPath,
      [join(directory, "scripts/setup-local.mjs")],
      { cwd: directory, windowsHide: true },
    );
    assert.ok(!startup.stdout.includes(existingPassword));
    assert.match(startup.stdout, /https:\/\//);
  } finally {
    if (
      dirname(resolve(directory)) !== resolve(tmpdir()) ||
      !basename(directory).startsWith("tuxu-https-setup-")
    )
      throw new Error("拒绝清理非测试目录");
    await rm(directory, { recursive: true, force: true });
  }
});

test("default policy permits local, LAN, Docker bridge and public-IP HTTP logins and writes", async () => {
  const f = await fixture(resolve("dist"), {
    publicOrigin: "https://images.example.test",
    trustedProxies: ["10.20.0.2"],
  });
  try {
    for (const [host, remoteAddress] of [
      ["127.0.0.1:3001", "127.0.0.1"],
      ["192.168.1.20:3001", "192.168.1.9"],
      ["localhost:3001", "172.18.0.1"],
      ["203.0.113.20:3001", "198.51.100.40"],
    ]) {
      const headers = {
        host,
        origin: `http://${host}`,
        "x-forwarded-proto": "http",
      };
      const policy = await f.app.inject({
        url: "/api/auth/transport-policy",
        headers,
        remoteAddress,
      });
      assert.deepEqual(policy.json(), { requireHttps: false });
      const navigation = await f.app.inject({
        url: "/login",
        headers,
        remoteAddress,
      });
      assert.equal(navigation.statusCode, 200, host);
      assert.equal(
        navigation.headers.location,
        undefined,
        "PUBLIC_ORIGIN alone does not force HTTPS",
      );
      const login = await f.app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers,
        remoteAddress,
        payload: { username: "admin", password },
      });
      assert.equal(login.statusCode, 200, host);
      const setCookie = String(login.headers["set-cookie"]);
      assert.match(setCookie, /HttpOnly; SameSite=Strict/);
      assert.doesNotMatch(setCookie, /; Secure/);
      const session = { ...headers, cookie: setCookie.split(";")[0] };
      assert.equal(
        (
          await f.app.inject({
            url: "/api/workspace",
            headers: session,
            remoteAddress,
          })
        ).statusCode,
        200,
      );
      assert.equal(
        (
          await f.app.inject({
            method: "POST",
            url: "/api/workflow/settings",
            headers: session,
            remoteAddress,
            payload: { aspectRatio: "1:1" },
          })
        ).statusCode,
        200,
      );
      assert.equal(
        (
          await f.app.inject({
            method: "POST",
            url: "/api/auth/logout",
            headers: session,
            remoteAddress,
          })
        ).statusCode,
        200,
      );
    }
    const secure = await f.app.inject({
      url: "/api/auth/session",
      remoteAddress: "10.20.0.2",
      headers: { host: "images.example.test", "x-forwarded-proto": "https" },
    });
    assert.equal(
      secure.headers["strict-transport-security"],
      "max-age=0",
      "disabled enforcement must not pin a browser to HTTPS",
    );
  } finally {
    await f.close();
  }
});

test("enabled HTTPS enforcement blocks all HTTP clients and spoofed proxy headers", async () => {
  const f = await fixture(undefined, { requireHttps: true });
  try {
    for (const remoteAddress of [
      "203.0.113.8",
      "::ffff:203.0.113.8",
      "127.0.0.1",
    ]) {
      for (const url of [
        "/api/auth/login",
        "/api/auth/password",
        "/api/auth/accept-invitation",
      ]) {
        const response = await f.app.inject({
          method: "POST",
          url,
          remoteAddress,
          headers: {
            host: "images.example.test",
            "x-forwarded-proto": "https",
          },
          payload: { username: "admin", password },
        });
        assert.equal(response.statusCode, 426);
        assert.equal(response.headers["set-cookie"], undefined);
        assert.match(response.json().error, /HTTPS/);
      }
    }
    const spoofedLocal = await f.app.inject({
      method: "POST",
      url: "/api/auth/login",
      remoteAddress: "203.0.113.8",
      headers: { host: "localhost" },
      payload: { username: "admin", password },
    });
    assert.equal(spoofedLocal.statusCode, 426);
    assert.equal(
      (await f.app.inject({ url: "/login", remoteAddress: "203.0.113.8" }))
        .statusCode,
      426,
    );
    assert.equal(
      (await f.app.inject({ url: "/health", remoteAddress: "203.0.113.8" }))
        .statusCode,
      200,
    );
    const policy = await f.app.inject({
      url: "/api/auth/transport-policy",
      remoteAddress: "203.0.113.8",
    });
    assert.equal(policy.statusCode, 200);
    assert.deepEqual(policy.json(), { requireHttps: true });
    assert.equal(policy.headers["cache-control"], "no-store");
    assert.equal(
      (await f.db.query("SELECT COUNT(*) AS count FROM account_sessions"))
        .rows[0].count,
      0,
    );
  } finally {
    await f.close();
  }
});

test("only configured proxy peers can assert HTTPS, and HTTP navigation redirects to a fixed origin", async () => {
  const f = await fixture(undefined, {
    requireHttps: true,
    trustedProxies: ["10.20.0.2"],
    publicOrigin: "https://images.example.test",
  });
  try {
    const trusted = {
      host: "images.example.test",
      "x-forwarded-proto": "https",
      origin: "https://images.example.test",
    };
    const response = await f.app.inject({
      method: "POST",
      url: "/api/auth/login",
      remoteAddress: "10.20.0.2",
      headers: trusted,
      payload: { username: "admin", password },
    });
    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers["set-cookie"]), /; Secure/);
    assert.match(
      String(response.headers["strict-transport-security"]),
      /max-age=31536000/,
    );
    const session = await f.app.inject({
      url: "/api/auth/session",
      remoteAddress: "10.20.0.2",
      headers: {
        ...trusted,
        cookie: String(response.headers["set-cookie"]).split(";")[0],
      },
    });
    assert.match(
      String(session.headers["set-cookie"]),
      /; Secure/,
      "TLS session reads upgrade existing cookie attributes",
    );
    const untrusted = await f.app.inject({
      method: "POST",
      url: "/api/auth/login",
      remoteAddress: "10.20.0.3",
      headers: trusted,
      payload: { username: "admin", password },
    });
    assert.equal(untrusted.statusCode, 426);
    const downgrade = await f.app.inject({
      method: "POST",
      url: "/api/auth/login",
      remoteAddress: "10.20.0.2",
      headers: { ...trusted, origin: "http://images.example.test" },
      payload: { username: "admin", password },
    });
    assert.equal(downgrade.statusCode, 403);
    const navigation = await f.app.inject({
      url: "/?workspace=example&manage=1",
      remoteAddress: "203.0.113.8",
      headers: { host: "attacker.test" },
    });
    assert.equal(navigation.statusCode, 308);
    assert.equal(
      navigation.headers.location,
      "https://images.example.test/?workspace=example&manage=1",
    );
    const post = await f.app.inject({
      method: "POST",
      url: "/api/auth/login",
      remoteAddress: "10.20.0.2",
      payload: { username: "admin", password },
    });
    assert.equal(post.statusCode, 426);
    assert.equal(
      post.headers.location,
      undefined,
      "never redirect a password POST",
    );
  } finally {
    await f.close();
  }
});

test("transport configuration rejects partial certificates, open proxy trust and insecure origins", async () => {
  assert.equal((await loadTransportSecurity({})).requireHttps, false);
  assert.equal(
    (await loadTransportSecurity({ REQUIRE_HTTPS: "false" })).requireHttps,
    false,
  );
  assert.equal(
    (await loadTransportSecurity({ REQUIRE_HTTPS: "true" })).requireHttps,
    true,
  );
  await assert.rejects(
    loadTransportSecurity({ REQUIRE_HTTPS: "typo" }),
    /REQUIRE_HTTPS/,
  );
  await assert.rejects(
    loadTransportSecurity({ TLS_CERT_FILE: "missing.pem" }),
    /同时配置/,
  );
  for (const TRUSTED_PROXIES of [
    "true",
    "*",
    "0.0.0.0/0",
    "::/0",
    "127.0.0.1/999",
    "hostname.test",
  ])
    await assert.rejects(
      loadTransportSecurity({ TRUSTED_PROXIES }),
      /TRUSTED_PROXIES/,
    );
  for (const PUBLIC_ORIGIN of [
    "http://example.test",
    "https://user:pass@example.test",
    "https://example.test/login",
  ])
    await assert.rejects(
      loadTransportSecurity({ PUBLIC_ORIGIN }),
      /PUBLIC_ORIGIN/,
    );
  assert.deepEqual(
    (
      await loadTransportSecurity({
        TRUSTED_PROXIES: "127.0.0.1, ::1,10.20.0.0/24",
      })
    ).trustedProxies,
    ["127.0.0.1", "::1", "10.20.0.0/24"],
  );
});

test("a real TLS connection verifies the generated IP certificate and creates a secure session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tuxu-tls-"));
  let f: Awaited<ReturnType<typeof fixture>> | undefined;
  try {
    const files = await createLocalCertificate(directory, []);
    const ca = await readFile(files.ca);
    const transport = await loadTransportSecurity({
      TLS_CERT_FILE: files.cert,
      TLS_KEY_FILE: files.key,
    });
    f = await fixture(undefined, transport);
    await f.app.listen({ host: "127.0.0.1", port: 0 });
    const root = `https://127.0.0.1:${(f.app.server.address() as AddressInfo).port}`;
    const result = await new Promise<{
      status: number;
      cookie: string;
      authorized: boolean;
      protocol: string | null;
      body: string;
    }>((resolve, reject) => {
      const req = request(
        `${root}/api/auth/login`,
        {
          method: "POST",
          ca,
          headers: { "Content-Type": "application/json", origin: root },
        },
        (res) => {
          const socket = req.socket as import("node:tls").TLSSocket;
          const authorized = socket.authorized,
            protocol = socket.getProtocol();
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () =>
            resolve({
              status: res.statusCode!,
              cookie: String(res.headers["set-cookie"]),
              authorized,
              protocol,
              body,
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify({ username: "admin", password }));
    });
    assert.equal(result.status, 200);
    assert.equal(result.authorized, true);
    assert.match(result.protocol!, /^TLSv1\.[23]$/);
    assert.match(result.cookie, /HttpOnly; SameSite=Strict;.*Secure/);
    assert.equal(JSON.parse(result.body).authenticated, true);
    assert.ok(!result.cookie.includes(password));
    await assert.rejects(
      new Promise<void>((resolve, reject) => {
        const req = get(`${root}/health`, (res) => {
          res.resume();
          resolve();
        });
        req.on("error", reject);
      }),
      /self-signed|certificate/i,
      "untrusted certificates must not be silently accepted",
    );
  } finally {
    await f?.close();
    if (
      dirname(resolve(directory)) !== resolve(tmpdir()) ||
      !basename(directory).startsWith("tuxu-tls-")
    )
      throw new Error("拒绝清理非测试目录");
    await rm(directory, { recursive: true, force: true });
  }
});
