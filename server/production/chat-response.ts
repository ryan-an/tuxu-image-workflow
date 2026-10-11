// OpenAI-compatible Chat endpoints may return JSON or Server-Sent Events.
// Assemble the entire answer before validating the suite; never use a partial JSON.
export class ChatAPIError extends Error {
  definitive = true;
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
    if (
      value.error ||
      (typeof value.code === "number" && value.code !== 0 && !value.choices)
    )
      throw new ChatAPIError(
        "分析平台明确返回失败，请检查模型、余额或平台记录",
      );
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
