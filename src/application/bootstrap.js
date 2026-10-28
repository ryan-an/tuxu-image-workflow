import { loadSnapshot } from "../integrations/storage.js";
import { APP_KEY, uid } from "../../shared/model.js";
import { normalizePromptTemplates } from "../../shared/prompt-templates.js";
import { api } from "../services/workspace-client.js";

import { migrateAutoSizeDefaults } from "../../shared/generation-settings.js";
import {
  DEFAULT_COMMON,
  FIXED_PRODUCT_REQUIREMENTS,
  migrateDefaultCommon,
} from "../../shared/prompt-suite.js";
import { migratePromptSettings } from "../../shared/doubao.js";

export async function loadWorkspace({ canImport = true } = {}) {
  let state;

  const production = import.meta.env.MODE !== "demo";
  if (production) {
    state = await api("/api/workspace/startup");
    if (canImport && !state.products.length) {
      const local = await loadSnapshot(APP_KEY);
      if (local?.schema === 2) {
        await api("/api/workspace/import", {
          commandId: uid(),
          workspace: local,
        });
        state = await api("/api/workspace/startup");
      }
    }
    state.activeProductId = state.products[0]?.id;
  } else {
    state = await loadSnapshot(APP_KEY);
    if (!state?.schema) {
      const { initialState } = await import("../demo/demo-images.js");
      state = initialState(await loadSnapshot("image-workflow-univer-demo-v1"));
    }
  }
  state.promptTemplates = normalizePromptTemplates(state.promptTemplates);
  if (!state.autoSizeDefaultsVersion) {
    state.settings = migrateAutoSizeDefaults(state.settings);
    state.autoSizeDefaultsVersion = 1;
  }
  if (!state.promptWorkflowVersion) {
    state.previousCommon = state.common;
    state.common = DEFAULT_COMMON;
    state.promptWorkflowVersion = 1;
    for (const job of state.jobs)
      if (
        ["prompt", "workflow"].includes(job.kind) &&
        !job.remoteId &&
        ["queued", "running", "interrupted"].includes(job.status)
      ) {
        job.status = "cancelled";
        job.error = "提示词已改为整套生成，请重新加入整套任务";
      }
  }
  if (state.promptWorkflowVersion === 1) {
    state.common = state.common.replace(
      "第三部份：固定产品要求由应用原样追加，不能修改。",
      `第三部份：（固定要求-不要变）\n${FIXED_PRODUCT_REQUIREMENTS}`,
    );
    state.promptWorkflowVersion = 2;
  }
  state.common = migrateDefaultCommon(state.common);
  const unfinished = state.jobs.filter((j) =>
    ["running", "queued"].includes(j.status),
  );
  if (!production) {
    for (const j of unfinished) j.status = "interrupted";
    if (unfinished.length) state.paused = true;
  }
  const server = await api("/api/workflow/settings");
  delete state.hasKey;
  delete state.hasPromptKey;
  const hasKey = server.hasKey;
  const hasPromptKey = server.hasPromptKey;
  delete server.hasKey;
  delete server.hasPromptKey;
  if (production || hasKey || hasPromptKey) {
    state.settings = { ...state.settings, ...server };
  }
  state.settings = migratePromptSettings(state.settings);

  return { state, hasKey, hasPromptKey, unfinished, production };
}
