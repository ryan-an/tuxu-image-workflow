const { mkdirSync } = require("node:fs");
const { dirname, resolve } = require("node:path");

function artifactPath(filename) {
  const target = resolve("artifacts", "tests", filename);
  mkdirSync(dirname(target), { recursive: true });
  return target;
}

module.exports = { artifactPath };
