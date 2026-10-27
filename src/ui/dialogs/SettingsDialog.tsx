import { useState } from "react";
import { MODELS } from "../../../shared/provider-config.js";
import { PROMPT_MODELS } from "../../../shared/service-models.js";
import { ActionButton, ApplicationForm, useApplication } from "../context.tsx";
import "./settings.css";
import { Badge } from "../design-system/Badge";
import { DialogActions } from "./DialogActions";

const imageModels = [
  "nano-banana-2",
  ...MODELS.filter((m) => m !== "nano-banana-2"),
];
function Options({ values }: { values: string[] }) {
  return values.map((value) => (
    <option key={value} value={value}>
      {value}
    </option>
  ));
}
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
export function SettingsDialog() {
  const { state, ui, isRemote, user } = useApplication(),
    config = state.settings,
    canManageKeys = user.role === "owner";
  const [imageModel, setImageModel] = useState(config.imageModel),
    [promptModel, setPromptModel] = useState(config.promptModel),
    [quality, setQuality] = useState(config.quality);
  const gpt = imageModel.startsWith("gpt-"),
    custom = promptModel === "__custom";
  return (
    <>
      <h2>对话与生图设置</h2>
      <p className="modal-subtitle">
        对话与提示词分析使用火山引擎豆包；图片生成使用 Grsai。
        {canManageKeys &&
          (isRemote
            ? "密钥由服务端加密保存。"
            : "密钥只保留在本次本地服务运行中。")}
      </p>
      <ApplicationForm id="settings-form">
        <input type="hidden" name="promptProvider" value="doubao" />
        {canManageKeys && <ProviderKeys />}
        <label>
          豆包对话模型
          <select
            name="promptModel"
            id="prompt-model"
            value={promptModel}
            onChange={(e) => setPromptModel(e.target.value)}
          >
            <Options
              values={[
                ...new Set(
                  [...PROMPT_MODELS, config.promptModel].filter(Boolean),
                ),
              ]}
            />
            <option value="__custom">其他豆包模型 / Endpoint ID</option>
          </select>
        </label>
        <label id="custom-prompt-model" hidden={!custom}>
          火山方舟 Model ID / Endpoint ID
          <input
            name="customPromptModel"
            disabled={!custom}
            placeholder="doubao-… 或 ep-…"
          />
        </label>
        {canManageKeys && (
          <p className="field-note">
            豆包服务地址：https://ark.cn-beijing.volces.com/api/v3。 API Key
            所属账号需先
            <a
              href="https://ark.volcengine.com/region:cn-beijing/openManagement"
              target="_blank"
              rel="noreferrer"
            >
              开通所选模型服务
            </a>
            ，仅创建 API Key 不会自动开通模型。
          </p>
        )}
        <div className="form-grid">
          <label>
            运行方式
            <select name="mode" defaultValue={config.mode}>
              {!isRemote && (
                <option value="demo">演示模式 · 不调用付费接口</option>
              )}
              <option value="live">真实调用 · 豆包 + Grsai</option>
            </select>
          </label>
          <label>
            Grsai 生图节点
            <select name="baseUrl" defaultValue={config.baseUrl}>
              <option value="https://grsai.dakka.com.cn">国内节点</option>
              <option value="https://grsaiapi.com">全球节点</option>
            </select>
          </label>
        </div>
        <div className="form-grid">
          <label>
            生图模型
            <select
              name="imageModel"
              id="image-model"
              value={imageModel}
              onChange={(e) => {
                setImageModel(e.target.value);
                setQuality(
                  /vip|flare|sunburst/.test(e.target.value) ? "medium" : "auto",
                );
              }}
            >
              <Options values={imageModels} />
            </select>
          </label>
        </div>
        <div id="nano-options" hidden={gpt} className="form-grid">
          <label>
            图片比例
            <select name="aspectRatio" defaultValue={config.aspectRatio}>
              <Options
                values={[
                  "auto",
                  "1:1",
                  "16:9",
                  "9:16",
                  "4:3",
                  "3:4",
                  "3:2",
                  "2:3",
                  "5:4",
                  "4:5",
                  "21:9",
                  "1:4",
                  "4:1",
                  "1:8",
                  "8:1",
                ]}
              />
            </select>
          </label>
          <label>
            分辨率
            <select name="imageSize" defaultValue={config.imageSize}>
              <Options values={["auto", "1K", "2K", "4K"]} />
            </select>
          </label>
        </div>
        <div id="gpt-options" hidden={!gpt} className="form-grid">
          <label>
            GPT 尺寸 / 比例
            <input
              name="gptSize"
              defaultValue={config.gptSize}
              list="gpt-sizes"
            />
            <datalist id="gpt-sizes">
              <Options
                values={[
                  "auto",
                  "1024x1024",
                  "1536x1024",
                  "1024x1536",
                  "2048x2048",
                  "2880x2880",
                  "16:9",
                  "9:16",
                ]}
              />
            </datalist>
          </label>
          <label>
            GPT 质量
            <select
              name="quality"
              value={quality}
              onChange={(e) => setQuality(e.target.value)}
            >
              <Options
                values={["auto", "low", "medium", "high", "xhigh", "max"]}
              />
            </select>
          </label>
        </div>
        <p className="field-note">
          比例与分辨率默认 auto。分辨率 auto
          沿用模型默认。队列保留提交时的配置。
        </p>
        <span id="settings-error" className="error-text">
          {ui.formError}
        </span>
        <DialogActions>
          <button type="submit" className="primary">
            保存设置
          </button>
        </DialogActions>
      </ApplicationForm>
    </>
  );
}
