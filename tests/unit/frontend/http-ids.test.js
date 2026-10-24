import test from "node:test";
import assert from "node:assert/strict";
import { uid, newProduct } from "../../../shared/model.js";

test("network HTTP can create UUIDs and product tasks without crypto.randomUUID", () => {
  const previous = Object.getOwnPropertyDescriptor(crypto, "randomUUID");
  Object.defineProperty(crypto, "randomUUID", {
    configurable: true,
    value: undefined,
  });
  try {
    const ids = Array.from({ length: 128 }, uid);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids)
      assert.match(
        id,
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    const product = newProduct("HTTP-01", "HTTP 产品");
    assert.equal(product.tasks.length, 10);
    assert.equal(
      new Set([product.id, ...product.tasks.map((task) => task.id)]).size,
      11,
    );
  } finally {
    if (previous) Object.defineProperty(crypto, "randomUUID", previous);
    else Reflect.deleteProperty(crypto, "randomUUID");
  }
});
