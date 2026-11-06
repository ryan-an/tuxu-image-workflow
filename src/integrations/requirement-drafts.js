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
      )
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
) {
  try {
    if (content === base && templateChoice === baseTemplateChoice)
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
        }),
      );
    return true;
  } catch {
    return false;
  }
}
