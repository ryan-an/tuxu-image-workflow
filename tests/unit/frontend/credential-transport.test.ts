import test from "node:test";
import assert from "node:assert/strict";
import { allowsCredentials } from "../../../shared/transport-security.js";
import {
  login,
  changePassword,
  acceptInvitation,
} from "../../../src/services/authentication.js";

test("the browser follows runtime HTTPS policy and keeps network HTTP available by default", async (t) => {
  for (const hostname of [
    "192.168.1.10",
    "203.0.113.20",
    "app.example.test",
    "localhost",
    "127.0.0.1",
  ]) {
    const url = new URL(`http://${hostname}`);
    assert.equal(allowsCredentials(url), true);
    assert.equal(allowsCredentials(url, true), false);
  }
  assert.equal(allowsCredentials(new URL("https://example.com"), true), true);
  assert.equal(allowsCredentials({ protocol: "file:" }), false);
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: new URL("http://192.168.1.10"), dispatchEvent() {} },
  });
  let requireHttps = true;
  const credentialCalls: string[] = [];
  const fetch = t.mock.method(
    globalThis,
    "fetch",
    async (
      input: Parameters<typeof globalThis.fetch>[0],
      init?: Parameters<typeof globalThis.fetch>[1],
    ) => {
      if (input === "/api/auth/transport-policy") {
        assert.equal(init?.cache, "no-store");
        assert.equal(init?.credentials, "omit");
        return new Response(JSON.stringify({ requireHttps }), { status: 200 });
      }
      credentialCalls.push(String(input));
      return new Response(JSON.stringify({ authenticated: true }), {
        status: 200,
      });
    },
  );
  try {
    for (const work of [
      () => login("admin", "test-only-password"),
      () => changePassword("old-password", "new-password"),
      () => acceptInvitation("test-invitation", { password: "new-password" }),
    ])
      await assert.rejects(work, /HTTPS/);
    assert.equal(credentialCalls.length, 0);
    requireHttps = false;
    await login("admin", "test-only-password");
    await changePassword("old-password", "new-password");
    await acceptInvitation("test-invitation", { password: "new-password" });
    assert.deepEqual(credentialCalls, [
      "/api/auth/login",
      "/api/auth/password",
      "/api/auth/accept-invitation",
    ]);
    // A server switch takes effect immediately, without a cached policy or a new bundle.
    requireHttps = true;
    await assert.rejects(() => login("admin", "test-only-password"), /HTTPS/);
    assert.equal(credentialCalls.length, 3);
    assert.equal(fetch.mock.callCount(), 10);
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
