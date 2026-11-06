import type { ServerResponse } from "node:http";

/** Keep the latest cumulative snapshot per job while a client is backpressured. */
export function analysisStream(
  raw: ServerResponse,
  authenticated: () => Promise<unknown>,
) {
  const pending = new Map<string, any>();
  let flushing = false,
    waitingForDrain = false,
    closed = false;
  const active = () => !closed && !raw.destroyed && !raw.writableEnded;
  const close = () => {
    closed = true;
    pending.clear();
    raw.off("drain", drain);
    if (!raw.destroyed && !raw.writableEnded) raw.end();
  };
  const flush = async () => {
    if (flushing || waitingForDrain || !active()) return;
    flushing = true;
    try {
      while (pending.size && !waitingForDrain && active()) {
        if (!(await authenticated())) return close();
        if (!active()) return;
        const [id, event] = pending.entries().next().value!;
        pending.delete(id);
        waitingForDrain = !raw.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch {
      close();
    } finally {
      flushing = false;
      if (pending.size && !waitingForDrain && active()) void flush();
    }
  };
  function drain() {
    waitingForDrain = false;
    void flush();
  }
  raw.on("drain", drain);
  raw.once("close", close);
  return (event: any) => {
    if (!active()) return;
    const previous = pending.get(event.id);
    pending.set(
      event.id,
      event.finished
        ? event
        : { ...(previous?.finished ? undefined : previous), ...event },
    );
    void flush();
  };
}
