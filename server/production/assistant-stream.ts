import { once } from "node:events";
import type { FastifyReply } from "fastify";

/** Write each event directly to the socket; never assemble a full HTTP body. */
export function assistantStream(reply: FastifyReply, signal: AbortSignal) {
  reply.hijack();
  const raw = reply.raw;
  raw.statusCode = 200;
  const headers = {
    ...reply.getHeaders(),
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-store, no-transform",
    "X-Accel-Buffering": "no",
    Connection: "keep-alive",
  };
  for (const [name, value] of Object.entries(headers))
    if (value !== undefined) raw.setHeader(name, value);
  raw.flushHeaders();
  const heartbeat = setInterval(() => {
    if (!raw.destroyed && !raw.writableEnded && !raw.writableLength)
      raw.write(": keep-alive\n\n");
  }, 15000);
  heartbeat.unref();
  return {
    async send(event: string, data: object) {
      signal.throwIfAborted();
      if (raw.destroyed || raw.writableEnded) throw new Error("对话连接已关闭");
      if (!raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        await once(raw, "drain", { signal });
    },
    close() {
      clearInterval(heartbeat);
      if (!raw.destroyed && !raw.writableEnded) raw.end();
    },
  };
}
