export interface UpstreamFailure {
  status: number;
  code?: string;
  requestId?: string;
  action?: "open-model" | "check-model" | "check-key";
}

// Read only a bounded JSON error body. Error responses can keep connections open.
async function errorBody(response: Response) {
  if (
    !response.headers.get("content-type")?.includes("json") ||
    !response.body
  ) {
    void response.body?.cancel().catch(() => {});
    return {};
  }
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  const timer = setTimeout(() => void reader.cancel().catch(() => {}), 1000);
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
    return JSON.parse(text + decoder.decode());
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}

export async function doubaoFailure(
  response: Response,
  model: string,
  key: string,
) {
  const body = await errorBody(response);
  const clean = (value: unknown) =>
    typeof value === "string" ? value.replaceAll(key, "[已隐藏]") : "";
  const code = clean(body?.error?.code);
  const requestId = clean(response.headers.get("x-request-id"));
  const detail: UpstreamFailure = {
    status: response.status,
    code: /^[\w.-]{1,120}$/.test(code) ? code : undefined,
    requestId: /^[\w.-]{1,200}$/.test(requestId) ? requestId : undefined,
  };
  let message = `豆包请求失败（HTTP ${response.status}${detail.code ? `，${detail.code}` : ""}）`;
  if (code === "ModelNotOpen") {
    detail.action = "open-model";
    message = `豆包模型 ${clean(model)} 尚未在当前 API Key 所属账号开通（ModelNotOpen）。请前往火山方舟「开通管理」开通该模型，或在「模型设置」填写已开通的 Model ID / Endpoint ID。`;
  } else if (code === "InvalidEndpointOrModel.ModelIDAccessDisabled") {
    detail.action = "check-model";
    message =
      "当前账号不支持直接用 Model ID 调用，请在「模型设置」填写有权限的 ep-… 推理接入点 ID。";
  } else if (response.status === 404) {
    detail.action = "check-model";
    message = `豆包模型或推理接入点 ${clean(model)} 不存在或当前 API Key 无权访问（${detail.code || "HTTP 404"}）。请在「模型设置」核对 Model ID / Endpoint ID 及所属项目。`;
  } else if ([401, 403].includes(response.status)) {
    detail.action = "check-key";
    message = `豆包 API Key 无效或无权访问所选模型（${detail.code || `HTTP ${response.status}`}），请检查火山方舟密钥、项目及模型权限。`;
  } else if (response.status === 429) {
    message = `豆包请求受限（${detail.code || "HTTP 429"}），请检查模型配额、余额或稍后重试。`;
  }
  return { message, detail };
}
