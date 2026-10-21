import test from "node:test";
import assert from "node:assert/strict";
import { fixture, loginHeaders, password } from "../../support/production.js";

test("login creates a private session, rotates it, and logout revokes it", async () => {
  const f = await fixture();
  try {
    const anonymous = await f.app.inject("/api/workspace");
    assert.equal(anonymous.statusCode, 401);
    assert.equal(anonymous.headers["www-authenticate"], undefined);
    assert.equal(
      (await f.app.inject("/api/auth/session")).json().authenticated,
      false,
    );
    for (const payload of [
      { username: "admin", password: "wrong" },
      { username: "other", password },
    ]) {
      const response = await f.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload,
      });
      assert.equal(response.statusCode, 401);
      assert.equal(response.headers["set-cookie"], undefined);
      assert.equal(response.json().error, "用户名或密码不正确");
    }
    const first = await loginHeaders(f.app);
    assert.equal(
      (await f.app.inject({ url: "/api/workspace", headers: first }))
        .statusCode,
      200,
    );
    assert.equal(
      (await f.app.inject({ url: "/api/auth/session", headers: first })).json()
        .authenticated,
      true,
    );
    const renewed = await f.app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: first,
      payload: { username: "admin", password },
    });
    const setCookie = String(renewed.headers["set-cookie"]);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    assert.match(setCookie, /Max-Age=43200/);
    assert.ok(!setCookie.includes(password));
    const headers = { cookie: setCookie.split(";")[0] };
    assert.notEqual(headers.cookie, first.cookie);
    assert.equal(
      (await f.app.inject({ url: "/api/workspace", headers: first }))
        .statusCode,
      401,
    );
    const loggedOut = await f.app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers,
    });
    assert.equal(loggedOut.statusCode, 200);
    assert.match(String(loggedOut.headers["set-cookie"]), /Max-Age=0/);
    assert.equal(
      (await f.app.inject({ url: "/api/workspace", headers })).statusCode,
      401,
    );
    assert.equal(
      (await f.app.inject({ url: "/api/auth/session", headers })).json()
        .authenticated,
      false,
    );
    assert.equal(
      (await f.app.inject({ url: "/api/assets/missing" })).statusCode,
      401,
    );
    assert.equal(
      (await f.app.inject({ url: "/api/analysis/events" })).statusCode,
      401,
    );
    assert.equal(
      (await f.app.inject({ method: "POST", url: "/api/auth/logout" }))
        .statusCode,
      200,
    );
  } finally {
    await f.close();
  }
});

test("login and cookie-authenticated writes reject cross-site requests", async () => {
  const f = await fixture();
  try {
    const headers = await loginHeaders(f.app);
    for (const origin of [
      "https://attacker.invalid",
      "null",
      "https://localhost:81",
    ]) {
      for (const url of [
        "/api/auth/login",
        "/api/auth/logout",
        "/api/workflow/settings",
      ]) {
        const response = await f.app.inject({
          method: "POST",
          url,
          headers: { ...headers, origin },
          payload: { username: "admin", password },
        });
        assert.equal(response.statusCode, 403);
      }
    }
    const crossSite = await f.app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "sec-fetch-site": "cross-site" },
      payload: { username: "admin", password },
    });
    assert.equal(crossSite.statusCode, 403);
    assert.equal(
      (await f.app.inject({ url: "/api/workspace", headers })).statusCode,
      200,
    );
  } finally {
    await f.close();
  }
});

test("expired sessions and sessions from a previous server process cannot read workspace data", async (t) => {
  const f = await fixture();
  try {
    const headers = await loginHeaders(f.app);
    const now = Date.now();
    const clock = t.mock.method(
      Date,
      "now",
      () => now + 12 * 60 * 60 * 1000 + 1,
    );
    assert.equal(
      (await f.app.inject({ url: "/api/workspace", headers })).statusCode,
      401,
    );
    assert.equal(
      (await f.app.inject({ url: "/api/auth/session", headers })).json()
        .authenticated,
      false,
    );
    clock.mock.restore();
    const second = await loginHeaders(f.app);
    await f.reopen();
    assert.equal(
      (await f.app.inject({ url: "/api/workspace", headers: second }))
        .statusCode,
      401,
    );
  } finally {
    await f.close();
  }
});
