import { AppError, type Queryable } from "./types.js";
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

// Administrators keep preferences without creating a workspace membership.
// The storage choice is derived from current database identity, never a flag
// supplied by a client or a historical job payload.
async function settingsTable(
  tx: Queryable,
  workspaceId: string,
  accountId: string,
) {
  const member = (
    await tx.query(
      "SELECT 1 FROM workspace_members WHERE workspace_id=$1 AND account_id=$2",
      [workspaceId, accountId],
    )
  ).rows[0];
  if (member) return "member_generation_settings";
  const account = (
    await tx.query("SELECT system_role,status FROM accounts WHERE id=$1", [
      accountId,
    ])
  ).rows[0];
  if (account?.system_role === "super_admin" && account.status === "active")
    return "admin_generation_settings";
  throw new AppError("当前账号不能访问此工作区配置", 403);
}

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
  const table = await settingsTable(tx, workspaceId, accountId);
  const row = (
    await tx.query(
      `SELECT document FROM ${table} WHERE workspace_id=$1 AND account_id=$2`,
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
  const table = await settingsTable(tx, workspaceId, accountId);
  await tx.query(
    `INSERT INTO ${table}(workspace_id,account_id,document,updated_at)
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
