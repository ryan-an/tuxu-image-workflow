import { useState } from "react";
import type { UserIdentity } from "../../../shared/access";
import { adminAuditLogs } from "../../services/admin";
import { useAdminQuery } from "../../application/use-admin";
import { Button } from "../design-system/Button";
import { Badge } from "../design-system/Badge";
import { AdminIcon, type AdminIconName } from "./AdminIcon";
import { AdminAccounts, AdminAccountDetailView } from "./AdminAccounts";
import { AdminWorkspaces, AdminWorkspaceDetailView } from "./AdminWorkspaces";
import {
  AdminFeedback,
  AdminHeading,
  AdminPagination,
  AdminTable,
  beijingTime,
} from "./AdminCommon";
import "./admin.css";

const actionNames: Record<string, string> = {
  "account.create": "新建账号",
  "account.rename": "修改个人名称",
  "account.update": "修改个人名称",
  "account.reset-password": "重置密码",
  "account.revoke-sessions": "强制下线",
  "account.disable": "全局禁用账号",
  "account.delete": "删除账号",
  "account.enable": "启用账号",
  "workspace.create": "新建工作区",
  "workspace.rename": "重命名工作区",
  "workspace.archive": "归档工作区",
  "workspace.restore": "恢复工作区",
  "workspace.transfer-owner": "转让所有权",
  "workspace.access": "进入超级管理模式",
  "member.add": "添加成员",
  "member.create": "创建工作区成员",
  "member.update": "修改成员",
  "member.remove": "移除成员",
  "invitation.create": "创建邀请",
  "invitation.revoke": "撤销邀请",
  "workspace.settings.update": "修改工作区配置",
  "workspace.credentials.update": "修改工作区密钥",
  "workspace.concurrency.update": "历史调度参数变更",
  "request.failure": "管理请求失败",
};
export function AdminConsole({ account }: { account: UserIdentity }) {
  const initial = new URLSearchParams(window.location.search);
  const [screen, setScreen] = useState(
    initial.has("workspace") ? "workspaces" : "accounts",
  );
  const [selected, setSelected] = useState<string | null>(
    initial.get("workspace") || initial.get("account"),
  );
  function navigate(screen: string, id: string | null = null) {
    setScreen(screen);
    setSelected(id);
    window.history.replaceState(
      null,
      "",
      `/admin${id ? `?${screen === "accounts" ? "account" : "workspace"}=${encodeURIComponent(id)}` : ""}`,
    );
  }
  return (
    <div className="admin-console">
      <header className="admin-topbar">
        <a className="admin-brand" href="/admin">
          图序 <span>超级管理台</span>
        </a>
        <div>
          <span className="admin-muted">
            {account.displayName} · @{account.username}
          </span>
          <a href="/" className="admin-back-link">
            返回我的工作台
          </a>
        </div>
      </header>
      <div className="admin-layout">
        <aside className="admin-sidebar">
          <p>全局管理</p>
          <nav aria-label="超级管理台导航">
            {[
              ["accounts", "用户管理", "users"],
              ["workspaces", "工作区管理", "workspaces"],
              ["logs", "操作记录", "audit"],
            ].map(([id, label, icon]) => (
              <Button
                key={id}
                variant="ghost"
                aria-current={screen === id ? "page" : undefined}
                onClick={() => navigate(id)}
              >
                <AdminIcon name={icon as AdminIconName} />
                <span>{label}</span>
              </Button>
            ))}
          </nav>
          <p className="admin-sidebar-note">
            全部账号与工作区
            <br />
            所有管理操作记录真实操作者
          </p>
        </aside>
        <main className="admin-main">
          {screen === "accounts" ? (
            selected ? (
              <AdminAccountDetailView
                id={selected}
                onBack={() => navigate("accounts")}
                onWorkspace={(id) => navigate("workspaces", id)}
              />
            ) : (
              <AdminAccounts onAccount={(id) => navigate("accounts", id)} />
            )
          ) : screen === "workspaces" ? (
            selected ? (
              <AdminWorkspaceDetailView
                id={selected}
                onBack={() => navigate("workspaces")}
                onAccount={(id) => navigate("accounts", id)}
              />
            ) : (
              <AdminWorkspaces
                onWorkspace={(id) => navigate("workspaces", id)}
              />
            )
          ) : (
            <AdminLogs />
          )}
        </main>
      </div>
    </div>
  );
}
function AdminLogs() {
  const [q, setQ] = useState(""),
    [action, setAction] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [page, setPage] = useState(1);
  const model = useAdminQuery(
    () => adminAuditLogs({ q, action, from, to, page, pageSize: 30 }),
    [q, action, from, to, page],
  );
  const change = (set: (value: string) => void, value: string) => {
    set(value);
    setPage(1);
  };
  return (
    <>
      <AdminHeading
        title="操作记录"
        description="记录真实操作者、目标及结果，时间统一使用北京时间"
      />
      <form
        className="admin-filters admin-log-filters"
        onSubmit={(e) => e.preventDefault()}
      >
        <input
          type="search"
          aria-label="搜索操作目标"
          placeholder="搜索账号、工作区或目标 ID"
          value={q}
          onChange={(e) => change(setQ, e.target.value)}
        />
        <select
          aria-label="操作类型"
          value={action}
          onChange={(e) => change(setAction, e.target.value)}
        >
          <option value="">全部操作类型</option>
          {Object.entries(actionNames).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <label>
          开始日期
          <input
            type="date"
            aria-label="开始日期"
            value={from}
            onChange={(e) => change(setFrom, e.target.value)}
          />
        </label>
        <label>
          结束日期
          <input
            type="date"
            aria-label="结束日期"
            min={from}
            value={to}
            onChange={(e) => change(setTo, e.target.value)}
          />
        </label>
      </form>
      <AdminFeedback error={model.error} loading={model.loading} />
      {model.data && (
        <>
          <AdminTable
            headings={[
              "时间（北京）",
              "操作者",
              "操作",
              "目标",
              "结果 / 请求 ID",
            ]}
            empty={!model.data.items.length}
          >
            {model.data.items.map((log) => (
              <tr key={log.id}>
                <td>{beijingTime(log.createdAt)}</td>
                <td>
                  {log.actorUsername}
                  <small>{log.actorId}</small>
                </td>
                <td>
                  {actionNames[log.action] || log.action}
                  {Object.keys(log.changes || {}).length > 0 && (
                    <details>
                      <summary>查看变更</summary>
                      <pre>{JSON.stringify(log.changes, null, 2)}</pre>
                    </details>
                  )}
                </td>
                <td>
                  {log.workspaceName ||
                    log.targetUsername ||
                    log.workspaceId ||
                    log.targetAccountId ||
                    "—"}
                  <small>{log.workspaceId || log.targetAccountId}</small>
                </td>
                <td>
                  <Badge tone={log.result === "success" ? "success" : "danger"}>
                    {log.result === "success"
                      ? "成功"
                      : `失败 · ${log.errorCode || "请求失败"}`}
                  </Badge>
                  <small>{log.requestId}</small>
                </td>
              </tr>
            ))}
          </AdminTable>
          <AdminPagination {...model.data} onPage={setPage} />
        </>
      )}
    </>
  );
}
