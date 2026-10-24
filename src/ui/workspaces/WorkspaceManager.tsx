import { useState } from "react";
import type { WorkspaceSummary } from "../../../shared/access";
import { roleLabels } from "../../../shared/access";
import type { WorkspaceDirectoryModel } from "../../application/use-workspaces";
import { Button } from "../design-system/Button";
import { Badge } from "../design-system/Badge";
import "./workspaces.css";

export function WorkspaceManager({
  model,
  currentWorkspaceId,
  currentWorkspaceName,
  onCreate,
  onBack,
  onOpen,
  beforeChange,
  onUnavailable,
}: {
  model: WorkspaceDirectoryModel;
  currentWorkspaceId?: string;
  currentWorkspaceName?: string;
  onCreate(): void;
  onBack?(): void;
  onOpen(id: string): Promise<unknown>;
  beforeChange?(): Promise<unknown>;
  onUnavailable?(): void;
}) {
  const [editing, setEditing] = useState<string | null>(null),
    [confirm, setConfirm] = useState<{
      workspace: WorkspaceSummary;
      action: "archive" | "leave";
    } | null>(null),
    [localError, setLocalError] = useState("");
  return (
    <section className="workspace-manager">
      <div className="workspace-page-title">
        <div>
          <span className="eyebrow">YOUR WORKSPACES</span>
          <h1>工作区管理</h1>
          {currentWorkspaceId ? (
            <p className="workspace-current-context">
              <span />
              当前所在工作区：<strong>{currentWorkspaceName}</strong>
            </p>
          ) : (
            <p>选择一个工作区开始创作，也可以新建自己的空间。</p>
          )}
        </div>
        <div className="workspace-page-actions">
          {onBack && (
            <Button variant="secondary" onClick={onBack}>
              返回工作台
            </Button>
          )}
          <Button variant="primary" onClick={onCreate}>
            新建工作区
          </Button>
        </div>
      </div>
      {(model.error || localError) && (
        <p className="error-text" role="alert">
          {model.error || localError}
        </p>
      )}
      {model.loading ? (
        <p role="status">正在读取工作区…</p>
      ) : (
        <>
          {[true, false].map((owned) => {
            const items = model.workspaces.filter(
              (w) => (w.role === "owner") === owned,
            );
            return (
              <section className="workspace-group" key={String(owned)}>
                <h2>
                  {owned ? "我管理的" : "我加入的"}{" "}
                  <small>{items.length}</small>
                </h2>
                {!items.length ? (
                  <p className="workspace-empty">
                    {owned
                      ? "还没有自己的工作区，创建一个开始吧。"
                      : "接受邀请后，加入的工作区会显示在这里。"}
                  </p>
                ) : (
                  items.map((w) => (
                    <article
                      className={`workspace-card ${w.id === currentWorkspaceId ? "is-current" : ""}`}
                      key={w.id}
                      data-workspace-id={w.id}
                    >
                      <div className="workspace-card-icon" aria-hidden="true">
                        {w.name.slice(0, 1)}
                      </div>
                      <div className="workspace-card-info">
                        <div>
                          <h3>{w.name}</h3>
                          {w.id === currentWorkspaceId && (
                            <span className="workspace-current-label">
                              当前工作区
                            </span>
                          )}
                          <Badge
                            tone={
                              w.archivedAt
                                ? "neutral"
                                : owned
                                  ? "brand"
                                  : "neutral"
                            }
                          >
                            {w.archivedAt ? "已归档" : roleLabels[w.role]}
                          </Badge>
                        </div>
                        <p>
                          {w.memberCount} 位成员 ·{" "}
                          {new Date(w.createdAt).toLocaleDateString("zh-CN")}
                        </p>
                      </div>
                      <div className="workspace-card-actions">
                        {!w.archivedAt && (
                          <Button
                            variant="primary"
                            onClick={async () => {
                              try {
                                await onOpen(w.id);
                              } catch (e) {
                                setLocalError((e as Error).message);
                              }
                            }}
                          >
                            {w.id === currentWorkspaceId
                              ? "返回工作台"
                              : "进入工作区"}
                          </Button>
                        )}
                        {owned ? (
                          <>
                            <Button
                              variant="secondary"
                              disabled={model.pending}
                              onClick={() => {
                                setEditing(editing === w.id ? null : w.id);
                                setConfirm(null);
                              }}
                            >
                              重命名
                            </Button>
                            <Button
                              variant="ghost"
                              disabled={model.pending}
                              onClick={() => {
                                setConfirm({
                                  workspace: w,
                                  action: "archive",
                                });
                                setEditing(null);
                              }}
                            >
                              {w.archivedAt ? "恢复" : "归档"}
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="ghost"
                            disabled={model.pending}
                            onClick={() => {
                              setConfirm({ workspace: w, action: "leave" });
                              setEditing(null);
                            }}
                          >
                            退出
                          </Button>
                        )}
                      </div>
                      {editing === w.id && (
                        <form
                          className="workspace-inline-form"
                          onSubmit={async (e) => {
                            e.preventDefault();
                            if (
                              await model.rename(
                                w.id,
                                String(
                                  new FormData(e.currentTarget).get("name"),
                                ),
                              )
                            )
                              setEditing(null);
                          }}
                        >
                          <input
                            aria-label="新的工作区名称"
                            name="name"
                            defaultValue={w.name}
                            required
                            maxLength={60}
                          />
                          <Button
                            type="submit"
                            variant="primary"
                            disabled={model.pending}
                          >
                            保存名称
                          </Button>
                          <Button onClick={() => setEditing(null)}>取消</Button>
                        </form>
                      )}
                      {confirm?.workspace.id === w.id && (
                        <div className="workspace-confirm">
                          <p>
                            {confirm.action === "leave"
                              ? `退出「${w.name}」后，你将无法访问其中的资料。`
                              : w.archivedAt
                                ? `恢复「${w.name}」并重新开放访问？`
                                : `归档「${w.name}」后所有成员暂停访问，资料保留，可随时恢复。`}
                          </p>
                          <Button
                            variant={
                              confirm.action === "leave"
                                ? "danger"
                                : "secondary"
                            }
                            disabled={model.pending}
                            onClick={async () => {
                              setLocalError("");
                              try {
                                if (w.id === currentWorkspaceId && beforeChange)
                                  await beforeChange();
                                const ok =
                                  confirm.action === "leave"
                                    ? await model.leave(w.id)
                                    : await model.archive(w.id, !w.archivedAt);
                                if (ok) {
                                  setConfirm(null);
                                  if (
                                    w.id === currentWorkspaceId &&
                                    (confirm.action === "leave" ||
                                      !w.archivedAt)
                                  )
                                    onUnavailable?.();
                                }
                              } catch (e) {
                                setLocalError((e as Error).message);
                              }
                            }}
                          >
                            确认
                            {confirm.action === "leave"
                              ? "退出"
                              : w.archivedAt
                                ? "恢复"
                                : "归档"}
                          </Button>
                          <Button
                            disabled={model.pending}
                            onClick={() => setConfirm(null)}
                          >
                            取消
                          </Button>
                        </div>
                      )}
                    </article>
                  ))
                )}
              </section>
            );
          })}
        </>
      )}
    </section>
  );
}
