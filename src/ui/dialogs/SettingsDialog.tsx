import { useState } from "react";
import { MODELS } from "../../../shared/provider-config.js";
import { PROMPT_MODELS } from "../../service-models.js";
import { ActionButton, ApplicationForm, useApplication } from "../context.tsx";

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
export function KeyDialog() {
  const { ui, isRemote } = useApplication();
  return (
    <>
      <h2>Grsai 密钥</h2>
      <p className="modal-subtitle">
        {ui.hasKey ? "已配置密钥，可以替换。" : "填写后可以使用真实生成。"}
        {isRemote
          ? "密钥由服务端加密保存，重启后仍可使用。"
          : "重启本地服务后需要重新填写密钥。"}
      </p>
      <ApplicationForm id="key-form">
        <label>
          API 密钥
          <input
            type="password"
            autoFocus
            name="apiKey"
            autoComplete="off"
            required
            placeholder="sk-…"
          />
        </label>
        <div className="key-form-actions">
          <button className="primary" type="submit">
            保存密钥
          </button>
          <ActionButton action="clear-key">清除现有密钥</ActionButton>
          <span id="key-error" className="error-text">
            {ui.formError}
          </span>
        </div>
      </ApplicationForm>
      <p className="field-note">
        保存密钥不会启动生成任务。密钥不写入表格、工作流备份或浏览器保存。
      </p>
    </>
  );
}
export function SettingsDialog() {
  const { state, ui, isRemote } = useApplication(),
    config = state.settings;
  const [imageModel, setImageModel] = useState(config.imageModel),
    [promptModel, setPromptModel] = useState(config.promptModel),
    [quality, setQuality] = useState(config.quality);
  const gpt = imageModel.startsWith("gpt-"),
    custom = promptModel === "__custom";
  return (
    <>
      <h2>生成服务设置</h2>
      <p className="modal-subtitle">
        nano-banana 和 GPT 均使用 Grsai。
        {isRemote
          ? "密钥由服务端加密保存。"
          : "密钥只保留在本次本地服务运行中。"}
      </p>
      <ApplicationForm id="settings-form">
        <div className="form-grid">
          <label>
            运行方式
            <select name="mode" defaultValue={config.mode}>
              {!isRemote && (
                <option value="demo">演示模式 · 不调用付费接口</option>
              )}
              <option value="live">真实生成 · Grsai</option>
            </select>
          </label>
          <label>
            服务节点
            <select name="baseUrl" defaultValue={config.baseUrl}>
              <option value="https://grsai.dakka.com.cn">国内节点</option>
              <option value="https://grsaiapi.com">全球节点</option>
            </select>
          </label>
        </div>
        <label>
          API 密钥
          <input
            type="password"
            name="apiKey"
            autoComplete="off"
            placeholder={
              ui.hasKey ? "已配置，留空保留现有密钥" : "填写 Grsai API Key"
            }
          />
        </label>
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
          <label>
            提示词分析模型
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
              <option value="__custom">其他模型 · 手动填写</option>
            </select>
          </label>
          <label id="custom-prompt-model" hidden={!custom}>
            平台模型名称
            <input
              name="customPromptModel"
              disabled={!custom}
              placeholder="填写平台可用的模型名称"
            />
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
        <button type="submit" className="primary">
          保存设置
        </button>
        <span id="settings-error" className="error-text">
          {ui.formError}
        </span>
      </ApplicationForm>
    </>
  );
}
