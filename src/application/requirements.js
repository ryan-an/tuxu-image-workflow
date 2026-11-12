import { applyEdits, editable } from "../../shared/workspace-edits.js";
import { normalizePromptTemplates } from "../../shared/prompt-templates.js";

export function createRequirementCommands(context) {
  function productEdits(
    productId,
    content,
    before,
    templateId,
    beforeTemplateId,
  ) {
    if (!content.trim() || content.length > 100000)
      throw new Error("请填写生成要求，最多 100000 字");
    return [
      {
        path: ["products", productId, "promptRequirements"],
        before,
        value: content,
      },
      {
        path: ["products", productId, "promptTemplateId"],
        before: beforeTemplateId,
        value: templateId,
      },
    ];
  }
  async function commit(edits) {
    if (!context.canEdit) throw new Error("当前账号不能修改提示词要求");
    if (context.repository) {
      try {
        // A just-created product may still be waiting for the autosave timer.
        await context.repository.save();
        return await context.repository.edit(edits);
      } catch (error) {
        // Refresh saved values after a conflict; the dialog keeps its own text.
        await context.repository.refresh().catch(() => {});
        throw error;
      }
    }
    const next = applyEdits(editable(context.state), edits);
    context.state.promptTemplates = normalizePromptTemplates(
      next.promptTemplates,
    );
    for (const product of context.state.products) {
      product.promptRequirements = next.products[product.id].promptRequirements;
      product.promptTemplateId = next.products[product.id].promptTemplateId;
    }
    context.change();
    await context.persist();
  }
  return {
    /**
     * @param {string | null} [templateId]
     * @param {string | null} [beforeTemplateId]
     */
    async saveProductRequirements(
      productId,
      content,
      before,
      templateId = null,
      beforeTemplateId = null,
    ) {
      await commit(
        productEdits(productId, content, before, templateId, beforeTemplateId),
      );
      context.notify("已保存，下次生成提示词时生效");
    },
    /** @param {{ id: string, before: string | null, beforeTemplateId: string | null } | null} [product] */
    async savePromptTemplate(template, before, product = null) {
      normalizePromptTemplates({
        ...(context.state.promptTemplates ?? {}),
        [template.id]: template,
      });
      await commit([
        { path: ["promptTemplates", template.id], before, value: template },
        ...(product
          ? productEdits(
              product.id,
              template.content,
              product.before,
              template.id,
              product.beforeTemplateId,
            )
          : []),
      ]);
    },
    async deletePromptTemplate(template) {
      await commit([
        {
          path: ["promptTemplates", template.id],
          before: template,
          value: null,
        },
      ]);
    },
  };
}
