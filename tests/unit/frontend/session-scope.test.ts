import test from "node:test";
import assert from "node:assert/strict";
import {
  presentationAssetUrl,
  setSessionWorkspace,
} from "../../../src/services/session-scope.js";

test("admin presentation URLs bind local assets to the current tab without changing ordinary or external sources", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const origin = "https://images.example.test";
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: new URL(origin) },
  });
  const path = `/api/assets/${"a".repeat(64)}`;
  try {
    setSessionWorkspace("space-one", "owner");
    assert.equal(presentationAssetUrl(path), path);
    setSessionWorkspace("space-one", "owner", true);
    for (const source of [
      path,
      `${path}/thumbnail`,
      `${origin}${path}`,
      `${origin}${path}/thumbnail`,
    ]) {
      const result = new URL(presentationAssetUrl(source), origin);
      assert.equal(result.origin, origin);
      assert.equal(result.pathname, new URL(source, origin).pathname);
      assert.equal(result.searchParams.get("workspace"), "space-one");
      assert.equal(result.searchParams.get("account"), "owner");
      assert.equal(result.searchParams.get("admin"), "1");
    }
    const alreadyScoped = `${path}?workspace=old&account=other&admin=0&download=1#preview`;
    const updated = new URL(presentationAssetUrl(alreadyScoped), origin);
    assert.equal(updated.searchParams.get("workspace"), "space-one");
    assert.equal(updated.searchParams.get("account"), "owner");
    assert.equal(updated.searchParams.get("admin"), "1");
    assert.equal(updated.searchParams.get("download"), "1");
    assert.equal(updated.hash, "#preview");
    for (const source of [
      `https://other.example.test${path}`,
      `//other.example.test${path}`,
      `${origin}:8443${path}`,
      `${path}/download`,
      `${path}/thumbnail/extra`,
      "/api/assets/invalid",
      "/api/admin/accounts",
      "data:image/png;base64,AAA=",
      "blob:https://images.example.test/some-blob",
      "javascript:alert(1)",
      "not a URL",
      undefined,
    ])
      assert.equal(presentationAssetUrl(source), source);
    setSessionWorkspace("space-two", "owner", true);
    assert.equal(
      new URL(presentationAssetUrl(path), origin).searchParams.get("workspace"),
      "space-two",
    );
    setSessionWorkspace("space-two", "ordinary", false);
    assert.equal(presentationAssetUrl(path), path);
    setSessionWorkspace(undefined, "owner", true);
    assert.equal(presentationAssetUrl(path), path);
  } finally {
    setSessionWorkspace(undefined, undefined);
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
