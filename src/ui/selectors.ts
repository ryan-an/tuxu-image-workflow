import type { Workspace, Product } from "./types";
import { hasSelectedVersion } from "../../shared/model.js";
export const formatTime = (value: number) =>
  new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
export const statusNames = {
  queued: "排队中",
  running: "执行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "待恢复",
};
export const kindNames: Record<string, string> = {
  "prompt-set": "整套提示词",
  prompt: "生成提示词",
  image: "生成图片",
  workflow: "提示词 → 生图",
};
export const currentProduct = (state: Workspace) =>
  state.products.find((p) => p.id === state.activeProductId) ||
  state.products[0];
export const productStats = (product: Product) => ({
  done: product.tasks.filter(hasSelectedVersion).length,
  versions: product.tasks.reduce((n, t) => n + t.versions.length, 0),
});
export const selectedCount = (product?: Product) =>
  product?.tasks.reduce(
    (n, t) => n + t.versions.filter((v) => t.selectedIds.includes(v.id)).length,
    0,
  ) || 0;
