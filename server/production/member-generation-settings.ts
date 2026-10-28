import type { Queryable } from "./types.js";
import { DEFAULT_CONFIG } from "../../shared/provider-config.js";
import { PERSONAL_GENERATION_FIELDS } from "../../shared/generation-settings.js";

export const GENERATION_FIELDS = [
  "baseUrl",
  "imageModel",
  "promptProvider",
  "promptModel",
  "aspectRatio",
  "imageSize",
  "gptSize",
  "quality",
] as const;

type GenerationConfiguration = Record<
  (typeof GENERATION_FIELDS)[number],
  string
> & { mode: "live" };

// Only image preferences are personal. Conversation model, node and mode always
// come from the workspace, including when older member rows still contain them.
export function generationDefaults(
  settings: Record<string, any>,
): GenerationConfiguration {
  const defaults = { ...DEFAULT_CONFIG, ...settings };
  return {
    ...Object.fromEntries(GENERATION_FIELDS.map((key) => [key, defaults[key]])),
    mode: "live",
  } as GenerationConfiguration;
}

export async function memberGenerationSettings(
  tx: Queryable,
  workspaceId: string,
  accountId: string,
  defaults: Record<string, any>,
) {
  const row = (
    await tx.query(
      "SELECT document FROM member_generation_settings WHERE workspace_id=$1 AND account_id=$2",
      [workspaceId, accountId],
    )
  ).rows[0];
  return generationDefaults({
    ...defaults,
    ...Object.fromEntries(
      PERSONAL_GENERATION_FIELDS.filter(
        (key) => row?.document?.[key] !== undefined,
      ).map((key) => [key, row.document[key]]),
    ),
  });
}

export async function saveMemberGenerationSettings(
  tx: Queryable,
  workspaceId: string,
  accountId: string,
  settings: Record<string, any>,
) {
  await tx.query(
    `INSERT INTO member_generation_settings(workspace_id,account_id,document,updated_at)
     VALUES($1,$2,$3,$4) ON CONFLICT(workspace_id,account_id)
     DO UPDATE SET document=excluded.document,updated_at=excluded.updated_at`,
    [
      workspaceId,
      accountId,
      Object.fromEntries(
        PERSONAL_GENERATION_FIELDS.map((key) => [key, settings[key]]),
      ),
      Date.now(),
    ],
  );
}
