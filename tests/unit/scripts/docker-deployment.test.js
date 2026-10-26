import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { parseEnv } from "node:util";

const { artifactPath } = createRequire(import.meta.url)(
  resolve("tests/support/artifacts.cjs"),
);
const { configure, validateDomain } = await import(
  pathToFileURL(resolve("scripts/docker-configure.mjs")).href
);
const { shellQuote } = await import(
  pathToFileURL(resolve("scripts/docker-common.mjs")).href
);
async function fixture() {
  const directory = artifactPath(`docker-deployment/${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  return directory;
}

test("Docker updates preserve credentials, data volume identity and HTTPS domain", async () => {
  const directory = await fixture();
  await configure(directory, {
    image: "tuxu-image:1",
    domain: "tuxu.example.com",
  });
  const original = await readFile(join(directory, ".env"), "utf8");
  const originalSettings = JSON.parse(
    await readFile(join(directory, "deployment.json"), "utf8"),
  );
  const env = parseEnv(original);
  assert.match(env.CREDENTIAL_SECRET, /^[a-f0-9]{64}$/);
  assert.notEqual(env.APP_PASSWORD, "admin");
  await configure(directory, { image: "tuxu-image:2" });
  assert.equal(await readFile(join(directory, ".env"), "utf8"), original);
  const compose = await readFile(join(directory, "compose.yaml"), "utf8");
  assert.match(compose, /name: tuxu\n/);
  assert.match(compose, /image: tuxu-image:2/);
  assert.match(compose, /workspace:\/app\/data/);
  assert.match(compose, /127\.0\.0\.1:3001:3001/);
  assert.match(compose, /\$\{CREDENTIAL_SECRET:\?/);
  assert.match(compose, /caddy:/);
  assert.match(compose, /PUBLIC_ORIGIN: https:\/\/tuxu\.example\.com/);
  const peer = compose.match(/TRUSTED_PROXIES: (172\.30\.\d+\.\d+)/)?.[1];
  assert.ok(peer);
  assert.ok(compose.includes(`ipv4_address: ${peer}`));
  assert.ok(compose.includes(`subnet: ${originalSettings.proxySubnet}`));
  assert.equal(
    JSON.parse(await readFile(join(directory, "deployment.json"), "utf8"))
      .proxySubnet,
    originalSettings.proxySubnet,
  );
  assert.match(
    await readFile(join(directory, "Caddyfile"), "utf8"),
    /tuxu\.example\.com/,
  );
  await assert.rejects(
    configure(directory, { image: "tuxu-image:2", project: "other" }),
    /项目/,
  );
});

test("Existing invalid secrets are rejected without regeneration", async () => {
  const directory = await fixture();
  const broken = "APP_PASSWORD=existing-password\nCREDENTIAL_SECRET=invalid\n";
  await writeFile(join(directory, ".env"), broken);
  await assert.rejects(
    configure(directory, { image: "tuxu-image:1" }),
    /现有 .env/,
  );
  assert.equal(await readFile(join(directory, ".env"), "utf8"), broken);
});

test("Existing unrelated compose configuration is not overwritten", async () => {
  const directory = await fixture();
  const original = "services: {}\n";
  await writeFile(join(directory, "compose.yaml"), original);
  await assert.rejects(
    configure(directory, { image: "tuxu-image:1" }),
    /目录已有 compose.yaml/,
  );
  assert.equal(
    await readFile(join(directory, "compose.yaml"), "utf8"),
    original,
  );
});

test("A missing .env in an existing deployment must be restored, not regenerated", async () => {
  const directory = await fixture();
  await writeFile(
    join(directory, "deployment.json"),
    JSON.stringify({ project: "tuxu", domain: "" }),
  );
  await assert.rejects(
    configure(directory, { image: "tuxu-image:2" }),
    /从备份恢复/,
  );
  await assert.rejects(readFile(join(directory, ".env")), { code: "ENOENT" });
});

test("No-domain deployment only exposes loopback and rejects unsafe domain input", async () => {
  const directory = await fixture();
  await configure(directory, { image: "tuxu-image:1" });
  assert.doesNotMatch(
    await readFile(join(directory, "compose.yaml"), "utf8"),
    /caddy:/,
  );
  for (const domain of [
    "https://example.com",
    "example.com/path",
    "example.com\nmalicious",
    "$(command)",
  ])
    assert.throws(() => validateDomain(domain), /domain/);
  assert.equal(shellQuote("a'b"), "'a'\\''b'");
});
