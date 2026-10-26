import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";
import sharp from "sharp";
import type { Database } from "./types.js";
import { AppError } from "./types.js";
import { WORKSPACE } from "./repository.js";
export const ASSET_PATH = /^\/api\/assets\/([a-f0-9]{64})$/;
const MAX_IMAGE = 40 * 1024 * 1024;
export class Assets {
  private root: string;
  private previewActive = 0;
  private previewQueue: Array<() => void> = [];
  private previews = new Map<
    string,
    Promise<{ bytes: Buffer; mime: string }>
  >();
  constructor(
    private db: Database,
    root: string,
    private readonly workspaceId = WORKSPACE,
  ) {
    this.root = resolve(root);
  }
  async put(bytes: Buffer, mime: string) {
    mime = mime.split(";")[0].toLowerCase();
    const valid =
      (mime === "image/png" &&
        bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
      (mime === "image/jpeg" &&
        bytes[0] === 255 &&
        bytes[1] === 216 &&
        bytes[2] === 255) ||
      (mime === "image/webp" &&
        bytes.toString("ascii", 0, 4) === "RIFF" &&
        bytes.toString("ascii", 8, 12) === "WEBP") ||
      (mime === "image/gif" &&
        /^GIF8[79]a$/.test(bytes.toString("ascii", 0, 6)));
    if (!valid || bytes.length > MAX_IMAGE)
      throw new AppError("图片格式无效或超过 40MB");
    const hash = createHash("sha256");
    if (this.workspaceId !== WORKSPACE)
      hash.update(this.workspaceId).update("\0");
    const id = hash.update(mime).update(bytes).digest("hex");
    return this.db.transaction(async (tx) => {
      await mkdir(this.root, { recursive: true });
      const temporary = join(this.root, `${id}.${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, bytes, { flag: "wx" });
        await rename(temporary, join(this.root, id));
      } finally {
        await unlink(temporary).catch(() => {});
      }
      await tx.query(
        "INSERT INTO assets(id,workspace_id,mime,bytes) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET created_at=CAST(unixepoch('subsec')*1000 AS INTEGER) WHERE assets.workspace_id=excluded.workspace_id",
        [id, this.workspaceId, mime, bytes.length],
      );
      return `/api/assets/${id}`;
    });
  }
  // A grace period protects uploads and downloaded results not yet attached to
  // a product. All writes and reference checks share the database write lock.
  async collectUnused(now = Date.now()) {
    return this.db.transaction(async (tx) => {
      const referenced = new Set<string>();
      for (const sql of [
        "SELECT document AS value FROM workspace WHERE id=$1",
        "SELECT document AS value FROM products WHERE workspace_id=$1",
        "SELECT payload AS value FROM jobs WHERE workspace_id=$1",
        "SELECT response AS value FROM commands WHERE workspace_id=$1",
        "SELECT t.user_text AS value,t.assistant_text FROM assistant_turns t JOIN assistant_conversations c ON c.id=t.conversation_id WHERE c.workspace_id=$1",
        "SELECT document AS value FROM sheet_imports WHERE workspace_id=$1 AND expires_at >= $2",
      ]) {
        const rows = (
          await tx.query(
            sql,
            sql.includes("$2") ? [this.workspaceId, now] : [this.workspaceId],
          )
        ).rows;
        for (const row of rows)
          for (const match of JSON.stringify(row).matchAll(
            /\/api\/assets\/([a-f0-9]{64})/g,
          ))
            referenced.add(match[1]);
      }
      const candidates = (
        await tx.query(
          "SELECT id,bytes FROM assets WHERE created_at <= $1 AND workspace_id=$2",
          [now - 60 * 60 * 1000, this.workspaceId],
        )
      ).rows;
      let deleted = 0,
        bytes = 0;
      for (const asset of candidates) {
        if (referenced.has(asset.id) || this.previews.has(asset.id)) continue;
        const remove = async (path: string) => {
          try {
            await unlink(path);
          } catch (error: any) {
            if (error.code !== "ENOENT") throw error;
          }
        };
        await remove(join(this.root, "thumbnails", `${asset.id}.webp`));
        await remove(join(this.root, asset.id));
        await tx.query("DELETE FROM assets WHERE id=$1 AND workspace_id=$2", [
          asset.id,
          this.workspaceId,
        ]);
        deleted++;
        bytes += asset.bytes;
      }
      return { deleted, bytes };
    });
  }
  async get(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new AppError("图片不存在", 404);
    const row = await this.authorized(id);
    if (!row) throw new AppError("图片不存在", 404);
    return { bytes: await readFile(join(this.root, id)), mime: row.mime };
  }
  async thumbnail(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new AppError("图片不存在", 404);
    await this.authorized(id);
    if (this.previews.has(id)) return this.previews.get(id)!;
    const work = (async () => {
      const directory = join(this.root, "thumbnails");
      const path = join(directory, `${id}.webp`);
      try {
        return { bytes: await readFile(path), mime: "image/webp" };
      } catch (error: any) {
        if (error.code !== "ENOENT") throw error;
      }
      if (this.previewActive >= 3)
        await new Promise<void>((resolve) => this.previewQueue.push(resolve));
      else this.previewActive++;
      let bytes: Buffer;
      try {
        const source = await this.get(id);
        bytes = await sharp(source.bytes, { limitInputPixels: 100_000_000 })
          .rotate()
          .resize(320, 320, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 70 })
          .toBuffer();
      } finally {
        const next = this.previewQueue.shift();
        if (next) next();
        else this.previewActive--;
      }
      await mkdir(directory, { recursive: true });
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, bytes);
        await rename(temporary, path);
      } finally {
        await unlink(temporary).catch(() => {});
      }
      return { bytes, mime: "image/webp" };
    })();
    this.previews.set(id, work);
    try {
      return await work;
    } finally {
      this.previews.delete(id);
    }
  }
  async normalize(
    value: any,
    images = new Map<string, Promise<string>>(),
  ): Promise<any> {
    if (typeof value === "string" && value.startsWith("/api/assets/")) {
      const id = /^\/api\/assets\/([a-f0-9]{64})(?:\/thumbnail)?$/.exec(
        value,
      )?.[1];
      if (!id) throw new AppError("图片地址无效");
      await this.authorized(id);
      return value;
    }
    if (typeof value === "string" && value.startsWith("data:image/")) {
      if (images.has(value)) return images.get(value);
      const parsed =
        /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/.exec(
          value,
        );
      if (!parsed) throw new AppError("不支持的图片编码");
      if (!images.has(value))
        images.set(
          value,
          this.put(Buffer.from(parsed[2], "base64"), parsed[1]),
        );
      return images.get(value);
    }
    if (Array.isArray(value)) {
      const result = [];
      for (const item of value) result.push(await this.normalize(item, images));
      return result;
    }
    if (value && typeof value === "object") {
      const result: Record<string, any> = {};
      for (const [key, item] of Object.entries(value)) {
        if (["__proto__", "constructor", "prototype"].includes(key))
          throw new AppError("无效字段");
        result[key] = await this.normalize(item, images);
      }
      return result;
    }
    return value;
  }
  private async authorized(id: string) {
    const row = (
      await this.db.query(
        "SELECT * FROM assets WHERE id=$1 AND workspace_id=$2",
        [id, this.workspaceId],
      )
    ).rows[0];
    if (!row) throw new AppError("图片不存在", 404);
    return row;
  }
  async providerSource(source: string) {
    const match = ASSET_PATH.exec(source);
    if (match) {
      const { bytes, mime } = await this.get(match[1]);
      return `data:${mime};base64,${bytes.toString("base64")}`;
    }
    if (source.startsWith("data:image/")) return source;
    if (/^https:\/\//.test(source)) return source;
    throw new AppError("无效的素材地址");
  }
  async download(source: string, signal: AbortSignal) {
    if (source.startsWith("data:image/")) return this.normalize(source);
    const { bytes, mime } = await downloadImage(source, signal);
    return this.put(bytes, mime);
  }
}
function privateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const lower = address.toLowerCase();
  return (
    lower === "::" ||
    lower === "::1" ||
    /^f[cd]/.test(lower) ||
    /^fe[89ab]/.test(lower) ||
    lower.startsWith("::ffff:") ||
    lower.startsWith("ff")
  );
}
export async function downloadImage(
  source: string,
  signal: AbortSignal,
  allowedHosts?: string[],
) {
  let url = new URL(source);
  for (let hop = 0; hop < 4; hop++) {
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      (allowedHosts && !allowedHosts.includes(url.hostname))
    )
      throw new AppError("不允许的图片地址");
    const addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ""), {
      all: true,
    });
    if (!addresses.length || addresses.some((a) => privateAddress(a.address)))
      throw new AppError("不允许访问内部网络");
    // Pin the validated DNS addresses to the connection; resolving twice would
    // leave a DNS rebinding window between validation and download.
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const req = httpsRequest(
        url,
        {
          signal,
          lookup: (_hostname, options, callback) => {
            if (options.all) callback(null, addresses);
            else callback(null, addresses[0].address, addresses[0].family);
          },
        },
        resolve,
      );
      req.on("error", reject);
      req.end();
    });
    const status = response.statusCode || 502;
    if ([301, 302, 303, 307, 308].includes(status)) {
      const location = response.headers.location;
      response.destroy();
      if (!location) throw new AppError("图片重定向无效");
      url = new URL(location, url);
      continue;
    }
    if (status < 200 || status >= 300) {
      response.destroy();
      throw new AppError(`图片下载失败 (${status})`, 502);
    }
    if (Number(response.headers["content-length"]) > MAX_IMAGE) {
      response.destroy();
      throw new AppError("图片过大");
    }
    const mime = response.headers["content-type"] || "";
    if (!mime.startsWith("image/")) {
      response.destroy();
      throw new AppError("结果不是图片");
    }
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const value of response) {
        size += value.length;
        if (size > MAX_IMAGE) throw new AppError("图片过大");
        chunks.push(Buffer.from(value));
      }
    } finally {
      response.destroy();
    }
    return { bytes: Buffer.concat(chunks), mime };
  }
  throw new AppError("图片重定向次数过多");
}
