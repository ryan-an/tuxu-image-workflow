import { cp, mkdir } from "node:fs/promises";
const destination = `${process.argv[2] || "build-server"}/server/production/sqlite-migrations`;
await mkdir(destination, { recursive: true });
await cp("server/production/sqlite-migrations", destination, {
  recursive: true,
});
