import { useState } from "react";
import { MODELS } from "../../../shared/provider-config.js";
import { PROMPT_MODELS } from "../../../shared/service-models.js";
import { ApplicationForm, useApplication } from "../context.tsx";
import "./settings.css";
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
export function SettingsDialog() {
  const { state, ui, isRemote, user } = useApplication(),
    config = state.settings,
    canManageWorkspace = user.role === "owner";
  const [imageModel, setImageModel] = useState(config.imageModel),
    [promptModel, setPromptModel] = useState(config.promptModel),
    [quality, setQuality] = useState(config.quality);
  const gpt = imageModel.startsWith("gpt-"),
    custom = promptModel === "__custom";
  return (
    <>
      <h2>{canManageWorkspace ? "模型配置" : "我的生图配置"}</h2>
      <p className="modal-subtitle">
        生图模型、比例和分辨率仅用于你在当前工作区发起的任务。
        {canManageWorkspace &&
          "豆包对话模型、运行方式和生图节点由整个工作区共用。"}
      </p>
      <ApplicationForm id="settings-form">
        {canManageWorkspace && (
          <>
            <p className="field-note">工作区配置 · 对当前工作区所有成员生效</p>
            <input type="hidden" name="promptProvider" value="doubao" />
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
          </>
        )}
        <p className="field-note">我的生图配置 · 仅对本人在当前工作区生效</p>
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
