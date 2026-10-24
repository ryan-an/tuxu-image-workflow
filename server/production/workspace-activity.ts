import type { CurrentUser } from "../../shared/access.js";
import type { Queryable, Workspace } from "./types.js";
import {
  differences,
  editable,
  cellContent,
} from "../../shared/workspace-edits.js";

export async function recordWorkspaceActivity(
  tx: Queryable,
  workspaceId: string,
  before: Workspace,
  after: Workspace,
  actor?: CurrentUser,
) {
  const changes = differences(editable(before), editable(after))
    .filter(
      (edit: any) =>
        edit.path.at(-1) !== "photoThumbnail" &&
        !(edit.path[0] === "sheetSnapshot" && !edit.path.includes("cellData")),
    )
    .flatMap((edit: any) => {
      if (edit.path[0] === "sheetSnapshot") {
        if (!before.sheetSnapshot) return [];
        const previous = cellContent(edit.before),
          value = cellContent(edit.value);
        return JSON.stringify(previous) === JSON.stringify(value)
          ? []
          : [{ ...edit, before: previous, value }];
      }
      const product =
        after.products.find((p) => p.id === edit.path[1]) ||
        before.products.find((p) => p.id === edit.path[1]);
      const task = product?.tasks.find((t) => t.id === edit.path[3]);
      return [{ ...edit, product: product?.code, role: task?.role }];
    });
  if (!changes.length) return;
  // Large table imports remain one operation, split into bounded detail pages.
  for (let offset = 0; offset < changes.length; offset += 100) {
    await tx.query(
      "INSERT INTO workspace_activity(workspace_id,created_at,payload) VALUES($1,$2,$3)",
      [
        workspaceId,
        Date.now(),
        {
          actor: actor
            ? {
                id: actor.id,
                username: actor.username,
                displayName: actor.displayName,
              }
            : { id: "system", username: "system", displayName: "系统" },
          changes: changes.slice(offset, offset + 100),
        },
      ],
    );
  }
}

export async function workspaceActivity(tx: Queryable, workspaceId: string) {
  const rows = (
    await tx.query(
      "SELECT id,created_at,payload FROM workspace_activity WHERE workspace_id=$1 ORDER BY id DESC LIMIT 100",
      [workspaceId],
    )
  ).rows;
  return {
    items: rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      ...row.payload,
    })),
    next: null,
  };
}
