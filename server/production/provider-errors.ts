export interface UpstreamFailure {
  status: number;
  code?: string;
  requestId?: string;
  action?: "open-model" | "check-model" | "check-key";
}

// Read only a bounded error body. Error responses can keep connections open.
export async function errorBody(response: Response) {
  if (!response.body) return {};
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => {});
  }, 1000);
  let text = "",
    bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 65536) return {};
      text += decoder.decode(value, { stream: true });
    }
    if (timedOut) return {};
    text += decoder.decode();
    try {
      return JSON.parse(text);
    } catch {
      // Do not expose proxy HTML pages as model error messages.
      return response.headers.get("content-type")?.includes("text/plain") &&
        !/<[a-z!][^>]*>/i.test(text)
        ? { message: text }
        : {};
    }
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}

export function isUpstreamFailure(data: any): boolean {
  return !!(
    data?.error ||
    data?.response?.error ||
    ["failed", "violation", "incomplete"].includes(data?.status) ||
    ["failed", "incomplete"].includes(data?.response?.status) ||
    ["error", "response.failed", "response.incomplete"].includes(data?.type) ||
    (typeof data?.code === "number" && ![0, 200].includes(data.code))
  );
}

// Extract explicit error fields only: never serialize prompts, images or credentials.
export function platformFailure(
  body: any,
  options: {
    label: string;
    key: string;
    status: number;
    requestId?: string | null;
    taskId?: string;
    doubao?: boolean;
    model?: string;
  },
) {
  const clean = (value: unknown) => {
    const raw =
      typeof value === "string" || typeof value === "number"
        ? String(value)
        : "";
    return (options.key ? raw.replaceAll(options.key, "[已隐藏]") : raw)
      .replace(/\bBearer\s+[^\s"'<>]+/gi, "Bearer [已隐藏]")
      .replace(/\bsk-[a-zA-Z0-9_-]+/g, "[已隐藏]")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .trim()
      .slice(0, 2000);
  };
  const first = (...values: unknown[]) => values.map(clean).find(Boolean) || "";
  const error = body?.error ?? body?.response?.error;
  const code = first(error?.code, body?.code, error?.type);
  const reason = first(
    error?.message,
    error?.msg,
    error,
    body?.message,
    body?.msg,
    body?.detail,
  );
  const failureReason = first(
    body?.failure_reason,
    body?.response?.failure_reason,
    body?.incomplete_details?.reason,
    body?.response?.incomplete_details?.reason,
  );
  const requestId = first(
    options.requestId,
    body?.request_id,
    body?.requestId,
    error?.request_id,
    body?.response?.request_id,
  );
  const detail: UpstreamFailure = {
    status: options.status,
    code: /^[\w.-]{1,120}$/.test(code) ? code : undefined,
    requestId: /^[\w.-]{1,200}$/.test(requestId) ? requestId : undefined,
  };
  const reasons = [...new Set([reason, failureReason].filter(Boolean))];
  let message = `${options.label}：${reasons.join("；") || "平台未提供具体失败原因"}`;
  const identifiers = [
    options.status >= 400 ? `HTTP ${options.status}` : "",
    code ? `错误码：${code}` : "",
    detail.requestId ? `请求 ID：${detail.requestId}` : "",
    options.taskId ? `任务 ID：${clean(options.taskId)}` : "",
  ].filter(Boolean);
  if (identifiers.length) message += `（${identifiers.join("，")}）`;
  // Keep existing setup shortcuts, but base advice on explicit codes only.
  if (options.doubao && code === "ModelNotOpen") {
    detail.action = "open-model";
    message += `。豆包模型 ${clean(options.model)} 尚未在当前 API Key 所属账号开通，请前往火山方舟「开通管理」开通模型，或在「模型设置」填写已开通的 Model ID / Endpoint ID。`;
  } else if (
    options.doubao &&
    code === "InvalidEndpointOrModel.ModelIDAccessDisabled"
  ) {
    detail.action = "check-model";
    message += "。请在「模型设置」填写有权限的 ep-… 推理接入点 ID。";
  } else if (options.doubao && [401, 403].includes(options.status)) {
    detail.action = "check-key";
  } else if (options.doubao && options.status === 404) {
    detail.action = "check-model";
  }
  return { message, detail };
}
