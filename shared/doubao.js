export const DOUBAO_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
export const DOUBAO_DEFAULT_MODEL = "doubao-seed-2-1-pro-260915";

export function migratePromptSettings(settings = {}) {
  return {
    ...settings,
    promptProvider: "doubao",
    promptModel:
      settings.promptProvider === "doubao" ||
      /^(doubao-|ep-)/.test(settings.promptModel || "")
        ? settings.promptModel || DOUBAO_DEFAULT_MODEL
        : DOUBAO_DEFAULT_MODEL,
  };
}

export function responsesPayload(config, content, stream = false) {
  return {
    model: config.promptModel || DOUBAO_DEFAULT_MODEL,
    stream,
    thinking: { type: "disabled" },
    store: false,
    input: [
      {
        role: "user",
        content: content.map((item) =>
          item.type === "image_url"
            ? { type: "input_image", image_url: item.image_url.url }
            : { type: "input_text", text: item.text },
        ),
      },
    ],
  };
}

export function responsesText(data) {
  if (data.error || data.status === "failed")
    throw new Error("豆包分析明确返回失败，请检查模型、密钥或服务开通状态");
  if (data.status === "incomplete")
    throw new Error("豆包分析输出不完整，请检查输出长度限制后重试");
  if (data.status && data.status !== "completed")
    throw new Error("豆包分析尚未完成");
  return (data.output || [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text || "")
    .join("");
}
