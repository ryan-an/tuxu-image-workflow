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

export function readRequirementPosition(key, templateChoice) {
  try {
    const position = JSON.parse(
      localStorage.getItem(
        `${key}:position:${JSON.stringify(templateChoice)}`,
      ) || "null",
    );
    return position &&
      [position.start, position.end].every(
        (value) => Number.isSafeInteger(value) && value >= 0 && value <= 100000,
      ) &&
      position.end >= position.start &&
      ["forward", "backward", "none"].includes(position.direction) &&
      [position.scrollTop, position.scrollLeft].every(
        (value) => Number.isFinite(value) && value >= 0,
      )
      ? position
      : null;
  } catch {
    return null;
  }
}

export function writeRequirementPosition(key, templateChoice, position) {
  try {
    localStorage.setItem(
      `${key}:position:${JSON.stringify(templateChoice)}`,
      JSON.stringify(position),
    );
  } catch {
    // Position storage is optional and must not interrupt editing or saving.
  }
}
