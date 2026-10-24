import { sessionHeaders } from "./session-scope.js";
export interface AssistantContext {
  productId?: string;
  taskId?: string;
}
export interface AssistantTurn {
  id: string;
  userText: string;
  assistantText: string | null;
  model: string;
  status: "running" | "completed" | "failed" | "cancelled" | "interrupted";
  error: string;
  errorAction?: string;
  createdAt: number;
  updatedAt: number;
}
export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}
export interface AssistantConversation
  extends ConversationSummary,
    AssistantContext {
  turns: AssistantTurn[];
}
export class AssistantRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public action?: string,
    public conversation?: AssistantConversation,
  ) {
    super(message);
  }
}
export async function assistantApi<T>(
  path: string,
  body?: object,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/assistant/${path}`, {
    method: body ? "POST" : "GET",
    signal,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      ...sessionHeaders(),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body
      ? {
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await response.json();
  if (response.status === 401)
    window.dispatchEvent(new Event("tuxu:authentication-required"));
  if (!response.ok)
    throw new AssistantRequestError(
      data.error || "豆包请求失败，请重试",
      response.status,
      data.action,
      data.conversation,
    );
  return data;
}
export const conversationQuery = (context: AssistantContext) => {
  const query = new URLSearchParams();
  if (context.productId) query.set("productId", context.productId);
  if (context.taskId) query.set("taskId", context.taskId);
  return query.size ? `?${query}` : "";
};

export interface AssistantResult {
  text: string;
  model: string;
  conversation: AssistantConversation;
}
export interface AssistantTextEvent {
  type: "delta" | "snapshot";
  conversationId: string;
  turnId: string;
  text: string;
}
function requestFailure(data: any, status: number): never {
  if (status === 401 && typeof window !== "undefined")
    window.dispatchEvent(new Event("tuxu:authentication-required"));
  throw new AssistantRequestError(
    data.error || "豆包请求失败，请重试",
    status,
    data.action,
    data.conversation,
  );
}

/** Decode the live response as bytes arrive, including split UTF-8/SSE frames. */
export async function readAssistantStream(
  response: Response,
  onText: (event: AssistantTextEvent) => void,
): Promise<AssistantResult> {
  if (!response.ok) requestFailure(await response.json(), response.status);
  if (!response.headers.get("content-type")?.includes("text/event-stream"))
    return response.json();
  if (!response.body) throw new Error("豆包回复没有内容，请重试");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  function event(block: string): AssistantResult | undefined {
    const lines = block.split("\n");
    const type = lines
      .find((line) => line.startsWith("event:"))
      ?.slice(6)
      .trim();
    const content = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!content) return;
    const data = JSON.parse(content);
    if (type === "error") requestFailure(data, data.status || 502);
    if (type === "done") return data as AssistantResult;
    if (
      (type === "delta" && typeof data.delta === "string") ||
      (type === "snapshot" && typeof data.text === "string")
    )
      onText({
        type,
        conversationId: data.conversationId,
        turnId: data.turnId,
        text: type === "delta" ? data.delta : data.text,
      });
  }
  try {
    for (;;) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      pending = pending.replace(/\r\n/g, "\n");
      let boundary;
      while ((boundary = pending.indexOf("\n\n")) >= 0) {
        const result = event(pending.slice(0, boundary));
        pending = pending.slice(boundary + 2);
        if (result) return result;
      }
      if (pending.length > 16 * 1024 * 1024)
        throw new Error("豆包响应过大，请新建对话");
      if (done) {
        if (pending.trim()) {
          const result = event(pending);
          if (result) return result;
        }
        throw new Error("豆包连接中断，已收到的回复会保留，请重新读取记录");
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function streamAssistantChat(
  body: object,
  signal: AbortSignal,
  onText: (event: AssistantTextEvent) => void,
) {
  const response = await fetch("/api/assistant/chat", {
    method: "POST",
    signal,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      ...sessionHeaders(),
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({ ...body, stream: true }),
  });
  return readAssistantStream(response, onText);
}
