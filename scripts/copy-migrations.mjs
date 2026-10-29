import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
const source = "server/production/sqlite-migrations";
const destination = `${process.argv[2] || "build-server"}/server/production/sqlite-migrations`;
const files = (await readdir(source)).filter((name) => /^\d+\.sql$/.test(name));
await mkdir(destination, { recursive: true });
// Generated output must not retain SQL removed from the source tree.
for (const name of await readdir(destination)) {
  if (/^\d+\.sql$/.test(name) && !files.includes(name))
    await unlink(join(destination, name));
}
for (const name of files) {
  const sql = await readFile(join(source, name), "utf8");
  await writeFile(join(destination, name), sql.replace(/\r\n/g, "\n"));
}
