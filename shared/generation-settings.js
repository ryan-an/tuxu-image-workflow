export const AUTO_SIZE_DEFAULTS = {
  aspectRatio: "auto",
  imageSize: "auto",
  gptSize: "auto",
};

export const WORKSPACE_GENERATION_FIELDS = /** @type {const} */ ([
  "promptProvider",
  "promptModel",
  "mode",
  "baseUrl",
]);
export const PERSONAL_GENERATION_FIELDS = /** @type {const} */ ([
  "imageModel",
  "aspectRatio",
  "imageSize",
  "gptSize",
  "quality",
]);

export function migrateAutoSizeDefaults(settings = {}) {
  const result = { ...settings };
  const previous = {
    aspectRatio: "1:1",
    imageSize: "1K",
    gptSize: "1024x1024",
  };
  for (const [field, value] of Object.entries(previous))
    if (!result[field] || result[field] === value) result[field] = "auto";
  return result;
}
