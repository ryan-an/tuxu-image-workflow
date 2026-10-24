// OpenAI-compatible Chat endpoints may return JSON or Server-Sent Events.
import { responsesText } from "../../shared/doubao.js";
import { isUpstreamFailure } from "./provider-errors.js";
// Assemble the entire answer before validating the suite; never use a partial JSON.
export class ChatAPIError extends Error {
  definitive = true;
  constructor(
    message: string,
    public failure?: unknown,
  ) {
    super(message);
  }
}
export async function readResponsesResponse(
  response: Response,
  onText?: (text: string) => Promise<void>,
) {
  const result = (data: any) => {
    if (isUpstreamFailure(data))
      throw new ChatAPIError(
        data?.status === "incomplete"
          ? "豆包分析输出不完整"
          : "豆包分析明确返回失败",
        data,
      );
    try {
      return responsesText(data);
    } catch (error) {
      throw new ChatAPIError((error as Error).message);
    }
  };
  let text = "";
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    text = result(await response.json());
  } else {
    if (!response.body) throw new Error("豆包分析响应没有内容");
    const decoder = new TextDecoder();
    let pending = "",
      finished = false;
    const event = async (block: string) => {
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data || data.trim() === "[DONE]") return;
      const value = JSON.parse(data);
      if (isUpstreamFailure(value))
        throw new ChatAPIError(
          value.type === "response.incomplete"
            ? "豆包分析输出不完整，请检查输出长度限制后重试"
            : "豆包分析明确返回失败",
          value,
        );
      const previous = text;
      if (
        value.type === "response.output_text.delta" &&
        typeof value.delta === "string"
      )
        text += value.delta;
      if (value.type === "response.completed") {
        text = result(value.response) || text;
        finished = true;
      }
      if (text.length > 2 * 1024 * 1024) throw new Error("豆包分析响应过大");
      if (onText && text !== previous) await onText(text);
    };
    for await (const chunk of response.body as any) {
      pending += decoder.decode(chunk, { stream: true });
      pending = pending.replace(/\r\n/g, "\n");
      let boundary;
      while ((boundary = pending.indexOf("\n\n")) >= 0) {
        await event(pending.slice(0, boundary));
        pending = pending.slice(boundary + 2);
      }
      if (finished) break;
      if (pending.length > 2 * 1024 * 1024) throw new Error("豆包分析响应过大");
    }
    pending += decoder.decode();
    if (!finished && pending.trim()) await event(pending);
    if (!finished) throw new Error("豆包分析响应中途断开，未收到完成标记");
  }
  if (
    onText &&
    text &&
    !response.headers.get("content-type")?.includes("text/event-stream")
  )
    await onText(text);
  return { choices: [{ message: { content: text } }] };
}
export async function readChatResponse(
  response: Response,
  onText?: (text: string) => Promise<void>,
) {
  if (
    !response.ok ||
    !response.headers.get("content-type")?.includes("text/event-stream")
  )
    return response.json();
  if (!response.body) throw new Error("分析响应没有内容");
  const decoder = new TextDecoder();
  let pending = "",
    text = "",
    finished = false,
    reason = "";
  const event = (block: string) => {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return;
    if (data.trim() === "[DONE]") {
      finished = true;
      return;
    }
    const value = JSON.parse(data);
    if (isUpstreamFailure(value))
      throw new ChatAPIError("分析平台明确返回失败", value);
    const choice = value.choices?.[0];
    const content = choice?.delta?.content ?? choice?.message?.content;
    if (typeof content === "string") text += content;
    if (choice?.finish_reason) reason = choice.finish_reason;
    if (text.length > 2 * 1024 * 1024) throw new Error("分析响应过大");
  };
  for await (const chunk of response.body as any) {
    pending += decoder.decode(chunk, { stream: true });
    pending = pending.replace(/\r\n/g, "\n");
    let boundary;
    while ((boundary = pending.indexOf("\n\n")) >= 0) {
      event(pending.slice(0, boundary));
      pending = pending.slice(boundary + 2);
    }
    if (onText && text) await onText(text);
    if (finished) break;
    if (pending.length > 2 * 1024 * 1024) throw new Error("分析响应过大");
  }
  pending += decoder.decode();
  if (pending.trim()) event(pending);
  if (!finished && !reason) throw new Error("分析响应中途断开，未收到完成标记");
  if (reason === "length")
    throw new Error("分析结果达到输出长度限制，内容不完整");
  return { choices: [{ message: { content: text }, finish_reason: reason }] };
}
