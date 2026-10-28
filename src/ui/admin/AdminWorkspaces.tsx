import { useState } from "react";
import type { AdminWorkspaceDetail } from "../../../shared/admin";
import type { WorkspaceMember } from "../../../shared/access";
import { roleLabels } from "../../../shared/access";
import {
  adminAccounts,
  adminWorkspace,
  adminWorkspaces,
  createAdminWorkspace,
  renameAdminWorkspace,
  adminWorkspaceAction,
  adminWorkspaceResources,
  adminWorkspaceRequest,
  enterAdminWorkspace,
} from "../../services/admin";
import type { AdminInvitation, AdminSettings } from "../../services/admin";
import { invitationUrl } from "../../services/members";
import { useAdminMutation, useAdminQuery } from "../../application/use-admin";
import { Button } from "../design-system/Button";
import { Badge } from "../design-system/Badge";
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

export function AdminWorkspaces({
  onWorkspace,
}: {
  onWorkspace(id: string): void;
}) {
  const [q, setQ] = useState(""),
    [status, setStatus] = useState(""),
    [page, setPage] = useState(1),
    [creating, setCreating] = useState(false);
  const model = useAdminQuery(
    () => adminWorkspaces({ q, status, page, pageSize: 20 }),
    [q, status, page],
  );
  return (
    <>
      <AdminHeading
        title="工作区管理"
        description="管理全部工作区，无需加入成员"
      >
        <Button variant="primary" onClick={() => setCreating(true)}>
          新建工作区
        </Button>
      </AdminHeading>
      <AdminFilters
        workspace
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
              "工作区",
              "所有者",
              "成员",
              "状态",
              "创建时间（北京）",
              "操作",
            ]}
            empty={!model.data.items.length}
          >
            {model.data.items.map((w) => (
              <tr key={w.id}>
                <td>
                  <strong>{w.name}</strong>
                  <small>{w.id}</small>
                </td>
                <td>
                  {w.owner.displayName}
                  <small>
                    @{w.owner.username}
                    {w.owner.status === "disabled" ? " · 账号已禁用" : ""}
                  </small>
                </td>
                <td>{w.memberCount} 人</td>
                <td>
                  <StatusBadge
                    status={w.archivedAt === null ? "active" : "archived"}
                  />
                </td>
                <td>{beijingTime(w.createdAt)}</td>
                <td>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onWorkspace(w.id)}
                  >
                    管理
                  </Button>
                </td>
              </tr>
            ))}
          </AdminTable>
          <AdminPagination {...model.data} onPage={setPage} />
        </>
      )}
      {creating && (
        <CreateWorkspace
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            model.refresh();
            onWorkspace(id);
          }}
        />
      )}
    </>
  );
}
function AccountSelect({
  name,
  exclude = [],
  label = "选择账号",
}: {
  name: string;
  exclude?: string[];
  label?: string;
}) {
  const [q, setQ] = useState("");
  const result = useAdminQuery(
    () => adminAccounts({ q, status: "active", page: 1, pageSize: 100 }),
    [q],
  );
  return (
    <>
      <AdminField label="搜索有效账号" name="search">
        <input
          type="search"
          value={q}
          placeholder="输入用户名或个人名称"
          onChange={(e) => setQ(e.target.value)}
        />
      </AdminField>
      <AdminField label={label} name={name}>
        <select name={name} required defaultValue="">
          <option value="" disabled>
            请选择有效账号
          </option>
          {result.data?.items
            .filter((a) => !exclude.includes(a.id))
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.displayName} · @{a.username}
              </option>
            ))}
        </select>
      </AdminField>
      <AdminFeedback loading={result.loading} error={result.error} />
    </>
  );
}
function CreateWorkspace({
  onClose,
  onCreated,
}: {
  onClose(): void;
  onCreated(id: string): void;
}) {
  return (
    <AdminDialog
      title="新建工作区"
      confirm="创建工作区"
      onClose={onClose}
      onSubmit={async (d) => {
        const result = await createAdminWorkspace({
          name: String(d.get("name")).trim(),
          ownerId: String(d.get("ownerId")),
        });
        onCreated(result.id);
      }}
    >
      <AdminField label="工作区名称" name="name" />
      <AccountSelect name="ownerId" label="指定所有者" />
      <p className="admin-muted">
        仅指定所有者加入，新空间需单独配置 API Key。
      </p>
    </AdminDialog>
  );
}
export function AdminWorkspaceDetailView({
  id,
  onBack,
  onAccount,
}: {
  id: string;
  onBack(): void;
  onAccount(id: string): void;
}) {
  const [period, setPeriod] = useState("");
  const model = useAdminQuery(
    () => adminWorkspace(id, period || undefined),
    [id, period],
  );
  const resources = useAdminQuery(() => adminWorkspaceResources(id), [id]);
  const refresh = () => {
    model.refresh();
    resources.refresh();
  };
  return (
    <>
      <Button variant="ghost" onClick={onBack}>
        ← 全部工作区
      </Button>
      <AdminFeedback
        error={model.error || resources.error}
        loading={model.loading || resources.loading}
      />
      {model.data && (
        <WorkspaceDetail
          key={id}
          detail={model.data}
          members={resources.data?.members || []}
          invitations={resources.data?.invitations || []}
          settings={resources.data?.settings}
          period={period}
          setPeriod={setPeriod}
          refresh={refresh}
          onAccount={onAccount}
        />
      )}
    </>
  );
}
function WorkspaceDetail({
  detail,
  members,
  invitations,
  settings,
  period,
  setPeriod,
  refresh,
  onAccount,
}: {
  detail: AdminWorkspaceDetail;
  members: WorkspaceMember[];
  invitations: AdminInvitation[];
  settings?: AdminSettings;
  period: string;
  setPeriod(value: string): void;
  refresh(): void;
  onAccount(id: string): void;
}) {
  const { workspace: w, usage } = detail,
    archived = w.archivedAt !== null;
  const [dialog, setDialog] = useState<string | null>(null),
    [editing, setEditing] = useState<WorkspaceMember | null>(null),
    [link, setLink] = useState("");
  const mutation = useAdminMutation(refresh);
  const request = (path: string, body?: object, method?: string) =>
    adminWorkspaceRequest(w.id, path, body, method);
  const candidates = members.filter(
    (m) =>
      m.id !== w.owner.id &&
      m.status === "active" &&
      m.accountStatus === "active" &&
      (m as WorkspaceMember & { acceptedAt?: number | null }).acceptedAt !=
        null,
  );
  const titles: Record<string, string> = {
    rename: "重命名工作区",
    archive: "归档工作区",
    restore: "恢复工作区",
    transfer: "转让工作区所有权",
    add: "添加已有账号",
    invite: "邀请成员",
    settings: "工作区配置",
    keys: "工作区 API Key",
    member: "编辑工作区成员",
    remove: "移除工作区成员",
  };
  return (
    <>
      <AdminHeading title={w.name} description={`ID：${w.id}`}>
        <Button
          variant="primary"
          disabled={mutation.pending}
          onClick={() => void mutation.run(() => enterAdminWorkspace(w.id))}
        >
          {archived ? "只读查看工作区" : "进入工作区"}
        </Button>
      </AdminHeading>
      <AdminFeedback error={mutation.error} notice={mutation.notice} />
      {w.owner.status === "disabled" && (
        <p className="admin-warning">
          所有者账号已全局禁用，请处理所有权；其他有效成员可继续使用工作区。
        </p>
      )}
      <section className="admin-panel">
        <div className="admin-panel-heading">
          <h2>基本资料</h2>
          <StatusBadge status={archived ? "archived" : "active"} />
        </div>
        <dl className="admin-facts">
          <div>
            <dt>所有者</dt>
            <dd>
              {w.owner.displayName} · @{w.owner.username}
            </dd>
          </div>
          <div>
            <dt>成员数量</dt>
            <dd>{w.memberCount} 人</dd>
          </div>
          <div>
            <dt>创建时间（北京）</dt>
            <dd>{beijingTime(w.createdAt)}</dd>
          </div>
        </dl>
        <div className="admin-actions">
          <Button
            variant="secondary"
            disabled={archived}
            onClick={() => setDialog("rename")}
          >
            重命名
          </Button>
          <Button
            variant="secondary"
            disabled={archived}
            onClick={() => setDialog("transfer")}
          >
            转让所有权
          </Button>
          <Button
            variant={archived ? "secondary" : "danger"}
            onClick={() => setDialog(archived ? "restore" : "archive")}
          >
            {archived ? "恢复工作区" : "归档工作区"}
          </Button>
        </div>
        {archived && (
          <p className="admin-muted">
            已归档工作区可查看资料；恢复后可编辑、生成及管理配置。
          </p>
        )}
      </section>
      <section className="admin-panel">
        <div className="admin-panel-heading">
          <h2>配置与密钥</h2>
          <div className="admin-actions">
            <Button
              variant="secondary"
              size="sm"
              disabled={archived || !settings}
              onClick={() => setDialog("settings")}
            >
              模型配置
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={archived || !settings}
              onClick={() => setDialog("keys")}
            >
              API Key
            </Button>
          </div>
        </div>
        {settings && (
          <dl className="admin-facts">
            <div>
              <dt>豆包对话模型</dt>
              <dd>{settings.promptModel}</dd>
            </div>
            <div>
              <dt>豆包 API Key</dt>
              <dd>
                <Badge tone={settings.hasPromptKey ? "success" : "warning"}>
                  {settings.hasPromptKey
                    ? `已配置${settings.promptKeyHint ? ` · ${settings.promptKeyHint}` : ""}`
                    : "未配置"}
                </Badge>
              </dd>
            </div>
            <div>
              <dt>Grsai API Key</dt>
              <dd>
                <Badge tone={settings.hasKey ? "success" : "warning"}>
                  {settings.hasKey
                    ? `已配置${settings.keyHint ? ` · ${settings.keyHint}` : ""}`
                    : "未配置"}
                </Badge>
              </dd>
            </div>
          </dl>
        )}
        <p className="admin-muted">密钥由服务端加密保存，仅展示配置状态。</p>
      </section>
      <section className="admin-panel">
        <div className="admin-panel-heading">
          <h2>成功生图用量</h2>
          <label className="admin-month">
            北京时间自然月
            <input
              type="month"
              aria-label="用量月份"
              value={period || usage.period}
              onChange={(e) => setPeriod(e.target.value)}
            />
          </label>
        </div>
        <dl className="admin-facts">
          <div>
            <dt>空间总用量</dt>
            <dd>{usage.total} 张</dd>
          </div>
          <div>
            <dt>管理员操作</dt>
            <dd>{usage.administrator} 张</dd>
          </div>
          <div>
            <dt>成员用量</dt>
            <dd>{usage.total - usage.administrator} 张</dd>
          </div>
        </dl>
        {usage.members.length > 0 && (
          <AdminTable headings={["操作者", "来源", "成功生图"]}>
            {usage.members.map((m) => (
              <tr
                key={`${m.accountId}:${m.administrator ? "admin" : "member"}`}
              >
                <td>
                  {m.displayName}
                  <small>@{m.username}</small>
                </td>
                <td>{m.administrator ? "管理员操作" : "工作区成员"}</td>
                <td>{m.used} 张</td>
              </tr>
            ))}
          </AdminTable>
        )}
      </section>
      <div className="admin-panel-heading">
        <h2>工作区成员</h2>
        <div className="admin-actions">
          <Button
            variant="secondary"
            size="sm"
            disabled={archived}
            onClick={() => setDialog("invite")}
          >
            邀请成员
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={archived}
            onClick={() => setDialog("add")}
          >
            添加成员
          </Button>
        </div>
      </div>
      <AdminTable
        headings={["用户 / 空间内称呼", "角色", "成员状态", "本月用量", "操作"]}
        empty={!members.length}
      >
        {members.map((m) => (
          <tr key={m.id}>
            <td>
              <strong>{m.displayName}</strong>
              <small>@{m.username}</small>
            </td>
            <td>{roleLabels[m.role]}</td>
            <td>
              <StatusBadge status={m.status} />
              {m.accountStatus === "disabled" && (
                <div>
                  <Badge tone="danger">账号已全局禁用</Badge>
                </div>
              )}
            </td>
            <td>{m.used} 张</td>
            <td>
              <div className="admin-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onAccount(m.id)}
                >
                  查看用户
                </Button>
                {m.role !== "owner" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={archived}
                    onClick={() => {
                      setEditing(m);
                      setDialog("member");
                    }}
                  >
                    编辑成员
                  </Button>
                )}
              </div>
            </td>
          </tr>
        ))}
      </AdminTable>
      {invitations.length > 0 && (
        <section className="admin-panel admin-invitations">
          <h2>待使用的邀请</h2>
          {invitations.map((i) => (
            <div key={i.id}>
              <span>
                {i.username ? `@${i.username}` : "分享邀请"} ·{" "}
                {roleLabels[i.role]}
                <small>{beijingTime(i.expiresAt)} 到期</small>
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={archived || mutation.pending}
                onClick={() =>
                  void mutation.run(
                    () =>
                      request(
                        `/api/member-invitations/${encodeURIComponent(i.id)}`,
                        undefined,
                        "DELETE",
                      ),
                    "邀请已撤销",
                  )
                }
              >
                撤销邀请
              </Button>
            </div>
          ))}
        </section>
      )}
      {link && (
        <section className="admin-panel">
          <h2>分享邀请链接</h2>
          <input
            aria-label="邀请链接"
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
          />
          <p className="admin-muted">
            链接仅可使用一次，7 天后失效。请复制后分享给成员。
          </p>
        </section>
      )}
      {dialog && (
        <AdminDialog
          title={titles[dialog]}
          danger={dialog === "archive" || dialog === "remove"}
          confirm={
            dialog === "archive"
              ? "确认归档"
              : dialog === "restore"
                ? "确认恢复"
                : dialog === "transfer"
                  ? "确认转让"
                  : dialog === "add"
                    ? "添加成员"
                    : dialog === "invite"
                      ? "生成邀请链接"
                      : dialog === "remove"
                        ? "确认移除"
                        : "保存"
          }
          onClose={() => setDialog(null)}
          onSubmit={async (d) => {
            if (dialog === "rename")
              await renameAdminWorkspace(w.id, String(d.get("name")).trim());
            if (dialog === "archive" || dialog === "restore")
              await adminWorkspaceAction(w.id, dialog);
            if (dialog === "transfer")
              await adminWorkspaceAction(w.id, "transfer-owner", {
                accountId: String(d.get("accountId")),
              });
            if (dialog === "add")
              await request("/api/members/existing", {
                accountId: String(d.get("accountId")),
                displayName: String(d.get("displayName")).trim(),
                role: String(d.get("role")),
              });
            if (dialog === "invite") {
              const username = String(d.get("username") || "").trim();
              const result = await request(
                username ? "/api/members" : "/api/member-invitations",
                username
                  ? {
                      username,
                      displayName:
                        String(d.get("displayName") || username).trim() ||
                        username,
                      role: String(d.get("role")),
                      monthlyLimit: null,
                    }
                  : { role: String(d.get("role")) },
              );
              setLink(invitationUrl(result.token));
            }
            if (dialog === "settings") {
              const values = Object.fromEntries(d);
              await request("/api/workflow/settings", values);
            }
            if (dialog === "keys") {
              const values: Record<string, string | boolean> = {};
              for (const key of ["apiKey", "promptApiKey"])
                if (String(d.get(key) || "").trim())
                  values[key] = String(d.get(key)).trim();
              if (d.get("clearKey")) values.clearKey = true;
              if (d.get("clearPromptKey")) values.clearPromptKey = true;
              await request("/api/workflow/credentials", values);
            }
            if (dialog === "member" && editing)
              await request(
                `/api/members/${encodeURIComponent(editing.id)}`,
                {
                  displayName: String(d.get("displayName")).trim(),
                  role: String(d.get("role")),
                  monthlyLimit: editing.monthlyLimit,
                  enabled: d.get("enabled") === "on",
                },
                "PATCH",
              );
            if (dialog === "remove" && editing)
              await request(
                `/api/members/${encodeURIComponent(editing.id)}`,
                undefined,
                "DELETE",
              );
            refresh();
          }}
        >
          {dialog === "rename" ? (
            <AdminField label="工作区名称" name="name" value={w.name} />
          ) : dialog === "archive" ? (
            <>
              <p>归档后成员暂停访问，产品、图片与历史记录保留。</p>
              <p className="admin-warning">
                存在排队、执行中或中断未结束任务时，请先完成或取消任务，再归档。
              </p>
            </>
          ) : dialog === "restore" ? (
            <p>恢复「{w.name}」，有效成员可以继续访问。</p>
          ) : dialog === "transfer" ? (
            <>
              <AdminField label="新所有者" name="accountId">
                <select required name="accountId" defaultValue="">
                  <option value="" disabled>
                    选择已加入的有效成员
                  </option>
                  {candidates.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName} · @{m.username}
                    </option>
                  ))}
                </select>
              </AdminField>
              <p className="admin-muted">
                原所有者成为编辑者。admin 保持独立管理身份。
              </p>
            </>
          ) : dialog === "add" ? (
            <>
              <AccountSelect
                name="accountId"
                exclude={members.map((m) => m.id)}
              />
              <AdminField label="空间内称呼" name="displayName" />
              <RoleField />
            </>
          ) : dialog === "invite" ? (
            <>
              <AdminField
                label="定向邀请用户名（留空生成分享邀请）"
                name="username"
                required={false}
                maxLength={40}
              />
              <AdminField
                label="空间内称呼（定向邀请时填写）"
                name="displayName"
                required={false}
              />
              <RoleField />
            </>
          ) : dialog === "settings" && settings ? (
            <SettingsFields settings={settings} />
          ) : dialog === "keys" ? (
            <>
              <AdminField
                label="豆包 API Key"
                name="promptApiKey"
                type="password"
                maxLength={4096}
                required={false}
              />
              <label className="admin-check">
                <input type="checkbox" name="clearPromptKey" />
                清除现有豆包密钥
              </label>
              <AdminField
                label="Grsai API Key"
                name="apiKey"
                type="password"
                maxLength={4096}
                required={false}
              />
              <label className="admin-check">
                <input type="checkbox" name="clearKey" />
                清除现有 Grsai 密钥
              </label>
              <p className="admin-muted">
                留空保留；勾选清除时请勿同时填写对应密钥。
              </p>
            </>
          ) : dialog === "member" && editing ? (
            <>
              <AdminField
                label="空间内称呼"
                name="displayName"
                value={editing.displayName}
              />
              <RoleField value={editing.role} />
              <label className="admin-check">
                <input
                  type="checkbox"
                  name="enabled"
                  defaultChecked={editing.status !== "disabled"}
                />
                启用当前工作区成员
              </label>
              <p className="admin-muted">
                成员状态只影响当前工作区；全局账号状态在用户详情管理。
              </p>
              <Button
                variant="danger"
                size="sm"
                onClick={() => setDialog("remove")}
              >
                移除成员
              </Button>
            </>
          ) : dialog === "remove" ? (
            <p>
              将 @{editing?.username}{" "}
              移出当前工作区。资料、历史任务、个人账号及其他工作区关系保留。
            </p>
          ) : null}
        </AdminDialog>
      )}
    </>
  );
}
function RoleField({ value = "editor" }: { value?: string }) {
  return (
    <AdminField label="工作区角色" name="role">
      <select name="role" defaultValue={value}>
        <option value="editor">编辑者</option>
        <option value="viewer">查看者</option>
      </select>
    </AdminField>
  );
}
function SettingsFields({ settings: s }: { settings: AdminSettings }) {
  return (
    <>
      <p className="admin-muted">
        豆包模型和节点由工作区共用；生图参数用于管理员本人的任务。
      </p>
      <AdminField
        label="豆包对话模型 / Endpoint ID"
        name="promptModel"
        value={s.promptModel}
        maxLength={200}
      />
      <AdminField label="运行方式" name="mode">
        <select name="mode" defaultValue={s.mode}>
          <option value="live">真实调用</option>
        </select>
      </AdminField>
      <AdminField label="生图节点" name="baseUrl">
        <select name="baseUrl" defaultValue={s.baseUrl}>
          <option value="https://grsai.dakka.com.cn">国内节点</option>
          <option value="https://grsaiapi.com">全球节点</option>
        </select>
      </AdminField>
      <AdminField
        label="管理员生图模型"
        name="imageModel"
        value={s.imageModel}
        maxLength={100}
      />
      <div className="admin-form-grid">
        <AdminField label="图片比例" name="aspectRatio" value={s.aspectRatio} />
        <AdminField label="分辨率" name="imageSize" value={s.imageSize} />
        <AdminField label="GPT 尺寸" name="gptSize" value={s.gptSize} />
        <AdminField label="GPT 质量" name="quality" value={s.quality} />
      </div>
    </>
  );
}
