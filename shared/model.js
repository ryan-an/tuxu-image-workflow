import { latestJobs, executionStatus } from "./job-status.js";
import { normalizePromptTemplates } from "./prompt-templates.js";

export const ROLES = [
  "尺寸图",
  "卖点图",
  "细节图",
  "场景 1",
  "场景 2",
  "场景 3",
  "A+ 1",
  "A+ 2",
  "A+ 3",
  "A+ 4",
];
export const APP_KEY = "image-workflow-app-v2";
export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // getRandomValues remains available on network HTTP origins.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function newTask(role, reference = "") {
  return {
    id: uid(),
    role,
    references: reference ? [reference] : [],
    prompt: "",
    promptHistory: [],
    versions: [],
    selectedIds: [],
    primaryId: null,
    revision: 0,
  };
}
export function newProduct(code, name = "", facts = "") {
  return {
    id: uid(),
    code,
    name: name || code,
    facts,
    promptRequirements: null,
    photo: "",
    photoThumbnail: null,
    photos: [],
    promptSets: [],
    tasks: ROLES.map((role) => newTask(role)),
  };
}
export function chosen(task) {
  return task.versions.find((version) => version.id === task.primaryId);
}
export function hasSelectedVersion(task) {
  return task.versions.some((version) => task.selectedIds.includes(version.id));
}
export function selectVersion(task, versionId, checked) {
  if (!task.versions.some((v) => v.id === versionId)) return;
  if (checked) {
    task.primaryId = versionId;
    task.selectedIds = [versionId];
  } else {
    task.selectedIds = task.selectedIds.filter((id) => id !== versionId);
  }
}
export function setPrimary(task, id) {
  if (!task.versions.some((version) => version.id === id)) return;
  task.primaryId = id;
}
export function addVersion(task, source, prompt, origin = "generated") {
  const version = {
    id: uid(),
    source,
    prompt,
    origin,
    createdAt: Date.now(),
    number: task.versions.length + 1,
  };
  task.versions.push(version);
  if (["generated", "demo"].includes(origin))
    selectVersion(task, version.id, true);
  else if (!task.primaryId) setPrimary(task, version.id);
  return version;
}
export function savePrompt(task, prompt) {
  if (task.prompt && task.prompt !== prompt)
    task.promptHistory.push({ prompt: task.prompt, createdAt: Date.now() });
  task.prompt = prompt;
  task.revision++;
}
export function rulePrompt(product, task, common) {
  const specific =
    {
      尺寸图:
        "以产品为主体，清晰展示已提供的尺寸和包装数量。尺寸线准确，文字少而清楚；未提供的尺寸不要编造。",
      卖点图:
        "展示产品资料中可验证的核心卖点，以简洁模块呈现。不得编造性能、认证或承诺。",
      细节图: "展示材质、结构和表面细节，保持真实质感与正确比例。",
    }[task.role] ||
    (task.role.startsWith("场景")
      ? "展示符合用途的自然使用场景，产品清晰且尺度合理。不同场景采用不同构图。"
      : "设计电商 A+ 内容模块，标题清晰、布局简洁，产品与功能介绍相协调。");
  return `${common}\n产品：${product.name}（${product.code}）\n产品资料：${product.facts || "暂无额外规格，仅根据实拍和参考图"}\n图片类型：${task.role}\n${specific}\n参考图片的版式和视觉层级，使用本产品替换主体，保持形状、颜色、材质一致。请输出一张完整图片。`;
}
export function findTask(state, productId, taskId) {
  const product = state.products.find((p) => p.id === productId);
  return { product, task: product?.tasks.find((t) => t.id === taskId) };
}
export function taskStatusInfo(task, jobs = [], paused = false) {
  const execution = executionStatus(
    latestJobs(jobs).filter(
      (job) => job.taskId === task.id || job.taskIds?.includes(task.id),
    ),
    paused,
  );
  if (execution) return execution;
  if (hasSelectedVersion(task))
    return { label: "已选结果", tone: "done", busy: false };
  if (task.versions.length)
    return { label: "待选图", tone: "ready", busy: false };
  return {
    label: task.prompt ? "待生图" : "待提示词",
    tone: "waiting",
    busy: false,
  };
}
export const taskStatus = (task, jobs = []) => taskStatusInfo(task, jobs).label;
export function validBackup(value) {
  if (
    value?.schema !== 2 ||
    !Array.isArray(value.products) ||
    !Array.isArray(value.jobs) ||
    !value.settings ||
    typeof value.common !== "string"
  )
    return false;
  const codes = new Set();
  try {
    normalizePromptTemplates(value.promptTemplates);
  } catch {
    return false;
  }
  for (const p of value.products) {
    if (
      !p.id ||
      typeof p.code !== "string" ||
      codes.has(p.code) ||
      typeof p.name !== "string" ||
      (p.promptRequirements != null &&
        (typeof p.promptRequirements !== "string" ||
          !p.promptRequirements.trim() ||
          p.promptRequirements.length > 100000)) ||
      !Array.isArray(p.tasks) ||
      p.tasks.length !== ROLES.length
    )
      return false;
    codes.add(p.code);
    for (const t of p.tasks) {
      if (
        !t.id ||
        !ROLES.includes(t.role) ||
        typeof t.prompt !== "string" ||
        !Array.isArray(t.references) ||
        !Array.isArray(t.versions) ||
        !Array.isArray(t.selectedIds) ||
        !Array.isArray(t.promptHistory)
      )
        return false;
      if (
        t.references.some((s) => typeof s !== "string") ||
        t.versions.some(
          (v) =>
            !v.id ||
            typeof v.source !== "string" ||
            !(
              v.source.startsWith("data:image/") ||
              /^\/api\/assets\/[a-f0-9]{64}$/.test(v.source)
            ),
        )
      )
        return false;
    }
  }
  return ["demo", "live"].includes(value.settings.mode);
}
