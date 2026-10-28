import { useState } from "react";
import type { AdminAccountDetail } from "../../../shared/admin";
import { roleLabels } from "../../../shared/access";
import {
  adminAccount,
  adminAccountAction,
  adminAccounts,
  createAdminAccount,
  deleteAdminAccount,
  renameAdminAccount,
} from "../../services/admin";
import { useAdminMutation, useAdminQuery } from "../../application/use-admin";
import { Badge } from "../design-system/Badge";
import { Button } from "../design-system/Button";
import { AdminIcon } from "./AdminIcon";
import {
  AdminDialog,
  AdminFeedback,
  AdminField,
  AdminFilters,
  AdminHeading,
  AdminPagination,
  AdminTable,
  beijingTime,
  StatusBadge,
} from "./AdminCommon";

export function AdminAccounts({ onAccount }: { onAccount(id: string): void }) {
  const [q, setQ] = useState(""),
    [status, setStatus] = useState(""),
    [page, setPage] = useState(1),
    [creating, setCreating] = useState(false);
  const model = useAdminQuery(
    () => adminAccounts({ q, status, page, pageSize: 20 }),
    [q, status, page],
  );
  return (
    <>
      <AdminHeading
        title="用户管理"
        description="管理平台全部账号及其工作区访问"
      >
        <Button variant="primary" onClick={() => setCreating(true)}>
          <AdminIcon name="plus" />
          新建账号
        </Button>
      </AdminHeading>
      <AdminFilters
        q={q}
        status={status}
        onChange={(q, s) => {
          setQ(q);
          setStatus(s);
          setPage(1);
        }}
      />
      <AdminFeedback error={model.error} loading={model.loading} />
      {model.data && (
        <>
          <AdminTable
            headings={[
              "用户",
              "账号状态",
              "所属工作区",
              "创建时间（北京）",
              "操作",
            ]}
            empty={!model.data.items.length}
          >
            {model.data.items.map((a) => (
              <tr key={a.id}>
                <td>
                  <strong>{a.username}</strong>
                  {a.systemRole === "super_admin" && (
                    <Badge tone="brand">超级管理员</Badge>
                  )}
                  <small>{a.displayName}</small>
                </td>
                <td>
                  <StatusBadge status={a.status} />
                </td>
                <td>{a.workspaceCount} 个</td>
                <td>{beijingTime(a.createdAt)}</td>
                <td>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onAccount(a.id)}
                  >
                    查看详情
                  </Button>
                </td>
              </tr>
            ))}
          </AdminTable>
          <AdminPagination {...model.data} onPage={setPage} />
        </>
      )}
      {creating && (
        <AdminDialog
          title="新建账号"
          confirm="创建账号"
          onClose={() => setCreating(false)}
          onSubmit={async (data) => {
            await createAdminAccount({
              username: String(data.get("username")).trim(),
              displayName: String(data.get("displayName")).trim(),
              password: String(data.get("password")),
            });
            model.refresh();
          }}
        >
          <AdminField
            label="用户名"
            name="username"
            minLength={3}
            maxLength={40}
          />
          <AdminField label="个人名称" name="displayName" />
          <AdminField
            label="初始密码"
            name="password"
            type="password"
            minLength={10}
            maxLength={256}
          />
          <p className="admin-muted">
            创建全局账号后，可从工作区详情添加成员。
          </p>
        </AdminDialog>
      )}
    </>
  );
}

export function AdminAccountDetailView({
  id,
  onBack,
  onWorkspace,
}: {
  id: string;
  onBack(): void;
  onWorkspace(id: string): void;
}) {
  const model = useAdminQuery(() => adminAccount(id), [id]);
  return (
    <>
      <Button variant="ghost" onClick={onBack}>
        ← 用户列表
      </Button>
      <AdminFeedback loading={model.loading} error={model.error} />
      {model.data && (
        <AccountDetail
          key={id}
          detail={model.data}
          refresh={model.refresh}
          onWorkspace={onWorkspace}
          onDeleted={onBack}
        />
      )}
    </>
  );
}
function AccountDetail({
  detail,
  refresh,
  onWorkspace,
  onDeleted,
}: {
  detail: AdminAccountDetail;
  refresh(): void;
  onWorkspace(id: string): void;
  onDeleted(): void;
}) {
  const { account: a, workspaces } = detail;
  const [dialog, setDialog] = useState<string | null>(null);
  const mutation = useAdminMutation(refresh),
    protectedAccount = a.systemRole === "super_admin";
  const titles: Record<string, string> = {
    rename: "编辑个人名称",
    "reset-password": "重置用户密码",
    "revoke-sessions": "强制下线",
    disable: "全局禁用账号",
    enable: "启用账号",
    delete: "删除账号",
  };
  return (
    <>
      <AdminHeading title={a.displayName} description={`用户名：${a.username}`}>
        <StatusBadge status={a.status} />
      </AdminHeading>
      <AdminFeedback error={mutation.error} notice={mutation.notice} />
      <section className="admin-panel">
        <div className="admin-panel-heading">
          <h2>全局账号</h2>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setDialog("rename")}
          >
            <AdminIcon name="edit" />
            编辑名称
          </Button>
        </div>
        <dl className="admin-facts">
          <div>
            <dt>账号身份</dt>
            <dd>{protectedAccount ? "超级管理员" : "普通用户"}</dd>
          </div>
          <div>
            <dt>所属工作区</dt>
            <dd>{a.workspaceCount} 个</dd>
          </div>
          <div>
            <dt>拥有工作区</dt>
            <dd>{a.ownedWorkspaceCount} 个</dd>
          </div>
        </dl>
        {protectedAccount ? (
          <p className="admin-muted">
            默认管理员密码由 APP_PASSWORD 管理；账号保持启用。
          </p>
        ) : (
          <div className="admin-actions">
            {a.status === "active" && (
              <Button
                variant="secondary"
                onClick={() => setDialog("reset-password")}
              >
                <AdminIcon name="key" />
                重置密码
              </Button>
            )}
            {a.status !== "pending" && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => setDialog("revoke-sessions")}
                >
                  <AdminIcon name="logout" />
                  强制下线
                </Button>
                <Button
                  variant={a.status === "active" ? "danger" : "secondary"}
                  onClick={() =>
                    setDialog(a.status === "active" ? "disable" : "enable")
                  }
                >
                  <AdminIcon name={a.status === "active" ? "block" : "check"} />
                  {a.status === "active" ? "全局禁用账号" : "启用账号"}
                </Button>
              </>
            )}
            {a.status === "pending" && (
              <p className="admin-muted">
                待激活账号沿用邀请流程；请从工作区撤销邀请或由用户完成激活。
              </p>
            )}
            <Button variant="danger" onClick={() => setDialog("delete")}>
              <AdminIcon name="trash" />
              删除账号
            </Button>
          </div>
        )}
      </section>
      <h2 className="admin-section-title">所属工作区</h2>
      <AdminTable
        headings={["工作区", "角色", "成员状态", "本月成功生图", "操作"]}
        empty={!workspaces.length}
      >
        {workspaces.map((w) => (
          <tr key={w.id}>
            <td>
              <strong>{w.name}</strong>
              {w.archivedAt !== null && <Badge>已归档</Badge>}
            </td>
            <td>{roleLabels[w.role]}</td>
            <td>
              <StatusBadge status={w.memberStatus} />
            </td>
            <td>
              {w.used} 张<small>{w.period} · 北京时间</small>
            </td>
            <td>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onWorkspace(w.id)}
              >
                管理工作区
              </Button>
            </td>
          </tr>
        ))}
      </AdminTable>
      <p className="admin-muted admin-note">
        账号状态与工作区成员状态分别管理。
        {a.status === "disabled"
          ? "该账号已全局禁用，即使成员关系保留，也无法访问工作区。"
          : "成员禁用只影响对应工作区。"}
      </p>
      {dialog && (
        <AdminDialog
          title={titles[dialog]}
          danger={dialog === "disable" || dialog === "delete"}
          confirmDisabled={dialog === "delete" && a.ownedWorkspaceCount > 0}
          confirm={
            dialog === "delete"
              ? "确认删除账号"
              : dialog === "rename"
                ? "保存名称"
                : dialog === "reset-password"
                  ? "重置并撤销会话"
                  : dialog === "disable"
                    ? "确认全局禁用"
                    : dialog === "enable"
                      ? "确认启用"
                      : "确认下线"
          }
          onClose={() => setDialog(null)}
          onSubmit={async (data) => {
            if (dialog === "delete") {
              await deleteAdminAccount(a.id, String(data.get("username")));
              onDeleted();
              return;
            }
            if (dialog === "rename")
              await renameAdminAccount(
                a.id,
                String(data.get("displayName")).trim(),
              );
            else
              await adminAccountAction(
                a.id,
                dialog as
                  | "reset-password"
                  | "revoke-sessions"
                  | "disable"
                  | "enable",
                dialog === "reset-password"
                  ? { password: String(data.get("password")) }
                  : {},
              );
            refresh();
          }}
        >
          {dialog === "delete" ? (
            <>
              <p>
                删除 <strong>@{a.username}</strong>{" "}
                后，该账号将从用户列表移除，无法再登录或接受邀请，并退出全部工作区。此操作不提供恢复入口。
              </p>
              <p className="admin-muted">
                产品、图片、历史任务、用量和操作记录保留；已有排队和执行中任务继续完成。用户名保留，不可用于创建新账号。
              </p>
              {a.ownedWorkspaceCount > 0 ? (
                <div className="admin-warning">
                  <p>
                    该账号仍拥有 {a.ownedWorkspaceCount}{" "}
                    个工作区，请先转让全部所有权。
                  </p>
                  <div className="admin-actions">
                    {workspaces
                      .filter((w) => w.role === "owner")
                      .map((w) => (
                        <Button
                          key={w.id}
                          variant="secondary"
                          size="sm"
                          onClick={() => onWorkspace(w.id)}
                        >
                          管理 {w.name}
                        </Button>
                      ))}
                  </div>
                </div>
              ) : (
                <AdminField
                  label="输入用户名以确认删除"
                  name="username"
                  maxLength={40}
                />
              )}
            </>
          ) : dialog === "rename" ? (
            <>
              <AdminField
                label="个人名称"
                name="displayName"
                value={a.displayName}
              />
              <p className="admin-muted">
                仅修改全局名称；空间内称呼由成员设置维护。
              </p>
            </>
          ) : dialog === "reset-password" ? (
            <>
              <AdminField
                label="新密码"
                name="password"
                type="password"
                minLength={10}
                maxLength={256}
              />
              <p>完成后撤销 @{a.username} 的全部登录会话。</p>
            </>
          ) : dialog === "disable" ? (
            <>
              <p>
                将禁用 <strong>@{a.username}</strong>{" "}
                的平台登录和全部工作区访问，撤销登录会话及未使用的定向邀请。
              </p>
              <p className="admin-warning">
                涉及 {a.workspaceCount} 个工作区，其中 {a.ownedWorkspaceCount}{" "}
                个由此账号拥有。资料、图片、历史记录和所有权保留；排队及运行中的任务继续完成，如需停止请到工作区任务队列取消。
              </p>
            </>
          ) : dialog === "enable" ? (
            <>
              <p>恢复 @{a.username} 的全局登录资格。</p>
              <p className="admin-muted">
                已撤销的邀请、已禁用的成员关系需要分别处理。
              </p>
            </>
          ) : (
            <>
              <p>撤销 @{a.username} 的全部登录会话。</p>
              <p className="admin-muted">账号仍可使用原密码重新登录。</p>
            </>
          )}
        </AdminDialog>
      )}
    </>
  );
}
