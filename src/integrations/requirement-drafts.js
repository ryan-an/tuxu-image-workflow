export function requirementDraftKey(user, productId) {
  return `tuxu:requirements:${JSON.stringify([user.workspaceId, user.id, productId])}`;
}
export function readRequirementDraft(key) {
  try {
    const draft = JSON.parse(localStorage.getItem(key) || "null");
    return draft &&
      typeof draft.content === "string" &&
      draft.content.length <= 100000 &&
      typeof draft.base === "string"
      ? draft
      : null;
  } catch {
    return null;
  }
}
export function writeRequirementDraft(key, content, base) {
  try {
    if (content === base) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify({ content, base }));
    return true;
  } catch {
    return false;
  }
}
