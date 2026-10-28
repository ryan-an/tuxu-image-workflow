import { useState } from "react";
import { ActionButton, ApplicationForm, useApplication } from "../context.tsx";
import { Badge } from "../design-system/Badge";
import { DialogActions } from "./DialogActions";
import "./settings.css";

function ApiKeyField({
  name,
  title,
  purpose,
  configured,
  placeholder,
}: {
  name: string;
  title: string;
  purpose: string;
  configured: boolean;
  placeholder: string;
}) {
  const [filled, setFilled] = useState(false);
  const status = filled ? "pending" : configured ? "configured" : "missing";
  const id = `provider-key-${name}`;
  return (
    <div className="api-key-field" data-state={status}>
      <div className="api-key-heading">
        <label htmlFor={id}>{title}</label>
        <Badge
          className="api-key-status"
          role="status"
          tone={filled ? "warning" : configured ? "success" : "danger"}
        >
          <span className="api-key-status-icon" aria-hidden="true">
            {status === "configured" ? "✓" : status === "pending" ? "•" : "!"}
          </span>
          {filled ? "待保存" : configured ? "已配置" : "未配置"}
        </Badge>
      </div>
      <input
        id={id}
        type="password"
        name={name}
        autoComplete="off"
        aria-describedby={`${id}-note`}
        placeholder={configured ? "已配置，留空保留" : placeholder}
        onChange={(event) => setFilled(Boolean(event.target.value.trim()))}
      />
      <p id={`${id}-note`} className="api-key-note">
        {purpose} ·{" "}
        {filled
          ? configured
            ? "保存后替换现有密钥"
            : "保存后生效"
          : configured
            ? "留空保留现有密钥"
            : "填写密钥后保存"}
      </p>
      {configured && (
        <ActionButton
          className="api-key-clear"
          action={name === "promptApiKey" ? "clear-prompt-key" : "clear-key"}
          aria-label={name === "promptApiKey" ? "清除豆包密钥" : "清除生图密钥"}
        >
          清除密钥
        </ActionButton>
      )}
    </div>
  );
}
function ProviderKeys() {
  const { ui } = useApplication();
  return (
    <div className="form-grid provider-keys">
      <ApiKeyField
        name="promptApiKey"
        title="豆包对话 API Key"
        purpose="对话与提示词分析"
        configured={ui.hasPromptKey}
        placeholder="填写火山方舟 API Key"
      />
      <ApiKeyField
        name="apiKey"
        title="Grsai 生图 API Key"
        purpose="图片生成"
        configured={ui.hasKey}
        placeholder="填写 Grsai API Key"
      />
    </div>
  );
}

export function ApiKeysDialog() {
  const { ui, isRemote, user } = useApplication();
  if (user.role !== "owner") return null;
  return (
    <>
      <h2>工作区 API Key</h2>
      <p className="modal-subtitle">
        当前工作区成员共用，仅所有者可管理。
        {isRemote
          ? "密钥由服务端加密保存。"
          : "密钥只保留在本次本地服务运行中。"}
      </p>
      <ApplicationForm id="credentials-form">
        <ProviderKeys />
        <p className="field-note">
          豆包 API Key 所属账号需先在火山方舟开通所选模型服务。
        </p>
        <span id="credentials-error" className="error-text">
          {ui.formError}
        </span>
        <DialogActions>
          <button type="submit" className="primary">
            保存密钥
          </button>
        </DialogActions>
      </ApplicationForm>
    </>
  );
}
