import { ROLES } from "./model.js";

const rolesByKey = new Map(
  ROLES.map((role) => [role.replace(/\s+/g, "").toUpperCase(), role]),
);

// Accept equivalent typography, never infer a card from its array position.
export function normalizePromptRole(value) {
  if (typeof value !== "string") return undefined;
  const key = value
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/^(场景|A\+)\(([1-4])\)$/i, "$1$2")
    .toUpperCase();
  return rolesByKey.get(key);
}
