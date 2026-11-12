export function requirementDraftKey(user, productId) {
  return `tuxu:requirements:${JSON.stringify([user.workspaceId, user.id, productId])}`;
}
export function readRequirementDraft(key) {
  try {
    const draft = JSON.parse(localStorage.getItem(key) || "null");
    return draft &&
      typeof draft.content === "string" &&
      draft.content.length <= 100000 &&
      typeof draft.base === "string" &&
      [draft.templateChoice, draft.baseTemplateChoice].every(
        (choice) => choice == null || typeof choice === "string",
      ) &&
      (draft.templateDrafts == null ||
        (typeof draft.templateDrafts === "object" &&
          !Array.isArray(draft.templateDrafts) &&
          Object.entries(draft.templateDrafts).every(
            ([choice, content]) =>
              (choice === "" ||
                /^template:[A-Za-z0-9_-]{1,100}$/.test(choice)) &&
              typeof content === "string" &&
              content.length <= 100000,
          )))
      ? draft
      : null;
  } catch {
    return null;
  }
}
export function writeRequirementDraft(
  key,
  content,
  base,
  templateChoice = "",
  baseTemplateChoice = "",
  templateDrafts = {},
) {
  try {
    const inactiveDrafts = Object.fromEntries(
      Object.entries(templateDrafts).filter(
        ([choice]) => choice !== templateChoice,
      ),
    );
    if (
      content === base &&
      templateChoice === baseTemplateChoice &&
      !Object.keys(inactiveDrafts).length
    )
      localStorage.removeItem(key);
    else
      localStorage.setItem(
        key,
        JSON.stringify({
          content,
          base,
          ...(templateChoice || baseTemplateChoice
            ? { templateChoice, baseTemplateChoice }
            : {}),
          ...(Object.keys(inactiveDrafts).length
            ? { templateDrafts: inactiveDrafts }
            : {}),
        }),
      );
    return true;
  } catch {
    return false;
  }
}
