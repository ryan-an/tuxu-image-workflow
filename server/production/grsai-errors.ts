// Official failure_reason values and Chinese meanings:
// https://grsai.ai/zh/documents/gpt-image
// https://grsai.ai/zh/documents/nano-banana
// Other messages below are application translations of HTTP semantics and
// observed platform text, not an invented official Grsai error-code catalog.
import { missingImageResultMessage } from "../../shared/image-result.js";

const reasons: Record<string, string> = {
  input_moderation: "提示词或参考图片未通过平台审核，请调整内容后重试。",
  output_moderation: "生成的图片未通过平台审核，请调整提示词后重试。",
  error: "平台生成失败，请稍后重试。",
  "generate failed": "平台未能生成图片，请稍后重试。",
  "generate image failed": "平台未能生成图片，请稍后重试。",
  "invalid input parameters":
    "生图参数不符合平台要求，请检查模型、尺寸、质量和参考图片。",
  server_timeout: "平台生图处理超时，请稍后重试。",
};

const http: Record<number, string> = {
  400: "生图请求未被平台接受，请检查提示词、参考图片和模型参数。",
  401: "Grsai API Key 无效或已失效，请联系工作区所有者检查密钥。",
  402: "Grsai 账号无法完成支付，请联系工作区所有者检查余额和计费状态。",
  403: "当前 Grsai API Key 无权执行此请求，请联系工作区所有者检查权限。",
  404: "平台未找到所请求的接口或任务，请检查服务节点及任务是否仍可查询。",
  408: "平台等待请求超时，请稍后重试。",
  413: "本次生图提交的数据总量超过服务限制，请减少附图或使用较小图片后重试。单张图片较小也可能因多图合计超限。",
  415: "平台不支持本次提交的数据格式，请检查参考图片格式。",
  422: "平台无法处理当前生图参数，请检查模型、尺寸、质量和参考图片。",
  429: "平台请求过于频繁或暂时繁忙，请稍后重试。",
  500: "平台服务发生内部错误，请稍后重试。",
  502: "平台网关或上游服务异常，请稍后重试。",
  503: "平台服务暂时不可用，请稍后重试。",
  504: "平台网关等待上游响应超时，请稍后重试。",
};

export function grsaiFailureMessage(input: {
  status: number;
  code: string;
  reason: string;
  failureReason: string;
  taskStatus?: string;
}) {
  if (input.status === 413) return http[413];
  if (
    missingImageResultMessage(input.reason) ||
    missingImageResultMessage(input.failureReason)
  )
    return "平台暂未找到该任务的结果。多次查询仍失败时，可点击“重新生成”提交新任务。";
  if (input.code === "-22")
    return "平台找不到该任务，可能已超过结果查询有效期。可点击“重新生成”提交新任务。";
  for (const value of [input.failureReason, input.code, input.reason]) {
    const name = value.trim().toLowerCase();
    const mapped = Object.hasOwn(reasons, name) ? reasons[name] : undefined;
    if (mapped) return mapped;
  }
  if (input.taskStatus === "violation")
    return "本次生图内容未通过平台审核，请调整提示词或参考图片后重试。";
  // Prefer an already useful Chinese explanation to a generic HTTP fallback.
  if (/[\u3400-\u9fff]/.test(input.reason)) return undefined;
  return http[input.status];
}
