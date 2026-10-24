import { useState } from "react";
import type { FormEvent } from "react";
import { roleLabels, type WorkspaceMember } from "../../../shared/access";
import { useMembers } from "../../application/use-members";
import { Button } from "../design-system/Button";
import { Badge } from "../design-system/Badge";
import "./members.css";
import { useApplication } from "../context";

const roleDescriptions = {
  owner:
    "拥有工作区的完整管理权限，可管理团队成员、API Key、产品资料和生成结果。",
  editor: "可创建和编辑产品、调整提示词、生成图片、选图和导出结果。",
  viewer: "可查看产品资料、提示词和生成结果，下载图片。",
};

function MonthlyQuotaField({ limit = null }: { limit?: number | null }) {
  return (
    <label>
      每月任务额度
      <input name="monthlyLimit" value={limit ?? "不限"} disabled />
    </label>
  );
}

function fields(event: FormEvent<HTMLFormElement>) {
  const data = new FormData(event.currentTarget);
  return {
    displayName: String(data.get("displayName")).trim(),
    role: String(data.get("role")) as "editor" | "viewer",
  };
}
function MemberForm({
  account,
  pending,
  onSave,
  onCancel,
}: {
  account: WorkspaceMember;
  pending: boolean;
  onSave(
    input: ReturnType<typeof fields> & { enabled: boolean },
  ): Promise<boolean>;
  onCancel(): void;
}) {
  return (
    <form
      className="account-edit-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const input = fields(e);
        const data = new FormData(e.currentTarget);
        if (await onSave({ ...input, enabled: data.get("enabled") === "on" }))
          onCancel();
      }}
    >
      <label>
        成员名称
        <input
          name="displayName"
          defaultValue={account.displayName}
          required
          maxLength={60}
        />
      </label>
      <label>
        角色
        <select name="role" defaultValue={account.role}>
          <option value="editor">编辑者</option>
          <option value="viewer">查看者</option>
        </select>
      </label>
      <MonthlyQuotaField limit={account.monthlyLimit} />
      <label className="account-checkbox">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={account.status !== "disabled"}
        />
        启用账号
      </label>
      <div className="account-row-actions">
        <Button type="submit" variant="primary" disabled={pending}>
          保存
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={pending}>
          取消
        </Button>
      </div>
    </form>
  );
}
export function MembersPage() {
  const model = useMembers();
  const { user, controller } = useApplication();
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{
    account: WorkspaceMember;
    action: "invite" | "delete" | "transfer";
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  return (
    <div className="accounts-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">WORKSPACE MEMBERS</span>
          <h1>成员管理</h1>
          <p>管理「{user.workspaceName}」的协作成员和访问权限。</p>
        </div>
        <Button
          variant="secondary"
          onClick={() => void model.refresh()}
          disabled={model.pending}
        >
          刷新列表
        </Button>
      </div>
      <div className="account-role-guide">
        <p>
          <b>所有者</b> 管理成员、API Key 和全部资料
        </p>
        <p>
          <b>编辑者</b> 编辑产品、生成图片、选图和导出
        </p>
        <p>
          <b>查看者</b> 查看资料、历史版本和下载
        </p>
      </div>
      {model.error && (
        <p className="error-text" role="alert">
          {model.error}
        </p>
      )}
      {model.notice && (
        <p className="account-notice" role="status">
          {model.notice}
        </p>
      )}
      {model.invitation && (
        <section className="account-invitation" aria-label="账号邀请链接">
          <h2>分享邀请链接</h2>
          <p>
            有效期至{" "}
            {new Date(model.invitation.expiresAt).toLocaleString("zh-CN")}
            ，成功加入后自动失效。
          </p>
          <div className="account-share">
            <input
              aria-label="邀请链接"
              readOnly
              value={model.invitation.url}
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(model.invitation!.url);
                  setCopied(true);
                  setCopyError("");
                } catch {
                  setCopyError("请选中链接后手动复制");
                }
              }}
            >
              {copied ? "已复制" : "复制链接"}
            </Button>
          </div>
          <small>
            请在成员能访问的站点地址打开本页再复制；链接仅可使用一次。
          </small>
          {copyError && <p role="status">{copyError}</p>}
        </section>
      )}
      <section className="account-list account-link-create">
        <h2>邀请成员</h2>
        <p className="account-role-description">
          选择加入后的角色，分享链接给已有账号或新成员。
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setCopied(false);
            setCopyError("");
            await model.share(
              String(new FormData(e.currentTarget).get("role")) as
                | "editor"
                | "viewer",
            );
          }}
        >
          <label>
            成员角色
            <select name="role" defaultValue="editor" disabled={model.pending}>
              <option value="editor">编辑者</option>
              <option value="viewer">查看者</option>
            </select>
          </label>
          <Button type="submit" variant="primary" disabled={model.pending}>
            生成邀请链接
          </Button>
        </form>
      </section>
      <section className="account-create">
        <h2>按用户名邀请</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget,
              data = new FormData(form);
            setCopied(false);
            setCopyError("");
            if (
              await model.create({
                ...fields(e),
                username: String(data.get("username")),
              })
            )
              form.reset();
          }}
        >
          <fieldset disabled={model.pending} className="account-create-fields">
            <label>
              用户名
              <input
                name="username"
                required
                minLength={3}
                maxLength={40}
                pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]{2,39}"
                placeholder="例如 designer01"
                autoComplete="off"
              />
            </label>
            <label>
              成员名称
              <input
                name="displayName"
                required
                maxLength={60}
                placeholder="例如 张三"
              />
            </label>
            <label>
              角色
              <select name="role" defaultValue="editor">
                <option value="editor">编辑者</option>
                <option value="viewer">查看者</option>
              </select>
            </label>
            <label>
              <span className="account-target-hint">
                已有账号登录后确认加入；新账号通过邀请设置密码。
              </span>
            </label>
            <MonthlyQuotaField />
            <Button type="submit" variant="primary">
              {model.pending ? "处理中…" : "发送邀请"}
            </Button>
          </fieldset>
        </form>
      </section>
      {confirming && (
        <section className="account-confirm" aria-label="确认账号操作">
          <p>
            {confirming.action === "delete"
              ? `将 ${confirming.account.displayName} 移出当前工作区？对方的个人账号和其他工作区不受影响，已有资料和任务保留。`
              : confirming.action === "transfer"
                ? `将工作区转让给 ${confirming.account.displayName}？对方将成为所有者，你将变为编辑者。`
                : `为 ${confirming.account.displayName} 重新生成邀请？旧邀请链接将立即失效。`}
          </p>
          <Button
            variant="danger"
            disabled={model.pending}
            onClick={async () => {
              setCopied(false);
              if (
                await (confirming.action === "transfer"
                  ? model.transfer(user.workspaceId, confirming.account, () =>
                      controller.flush(),
                    )
                  : confirming.action === "delete"
                    ? model.remove(confirming.account)
                    : model.invite(confirming.account))
              )
                setConfirming(null);
            }}
          >
            确认
            {confirming.action === "transfer"
              ? "转让"
              : confirming.action === "delete"
                ? "移除"
                : "重新邀请"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => setConfirming(null)}
            disabled={model.pending}
          >
            取消
          </Button>
        </section>
      )}
      <section className="account-list">
        <h2>
          工作区成员 <small>{model.members.length}</small>
        </h2>
        {model.loading ? (
          <p role="status">正在读取账号…</p>
        ) : (
          model.members.map((account) => (
            <article className="account-member" key={account.id}>
              <div className="account-member-heading">
                <div>
                  <strong>{account.displayName}</strong>
                  <small>@{account.username}</small>
                </div>
                <Badge tone={account.role === "owner" ? "brand" : "neutral"}>
                  {roleLabels[account.role]}
                </Badge>
                <Badge
                  tone={
                    account.status === "active"
                      ? "success"
                      : account.status === "pending"
                        ? "warning"
                        : "neutral"
                  }
                >
                  {account.status === "active"
                    ? "已启用"
                    : account.status === "pending"
                      ? "待激活"
                      : "已禁用"}
                </Badge>
              </div>
              <p className="account-role-description">
                {roleDescriptions[account.role]}
              </p>
              {account.role !== "owner" && (
                <>
                  {editing === account.id ? (
                    <MemberForm
                      account={account}
                      pending={model.pending}
                      onSave={(input) => model.update(account, input)}
                      onCancel={() => setEditing(null)}
                    />
                  ) : (
                    <div className="account-row-actions account-member-actions">
                      <Button
                        variant="secondary"
                        disabled={model.pending}
                        onClick={() => {
                          setEditing(account.id);
                          setConfirming(null);
                        }}
                      >
                        编辑权限
                      </Button>
                      {account.status === "pending" && (
                        <Button
                          variant="secondary"
                          disabled={model.pending}
                          onClick={() => {
                            setConfirming({ account, action: "invite" });
                            setEditing(null);
                          }}
                        >
                          重新邀请
                        </Button>
                      )}
                      {account.status === "active" && (
                        <Button
                          variant="secondary"
                          disabled={model.pending}
                          onClick={() => {
                            setConfirming({ account, action: "transfer" });
                            setEditing(null);
                          }}
                        >
                          转让所有权
                        </Button>
                      )}
                      <Button
                        variant="danger"
                        disabled={model.pending}
                        onClick={() => {
                          setConfirming({ account, action: "delete" });
                          setEditing(null);
                        }}
                      >
                        移除成员
                      </Button>
                    </div>
                  )}
                </>
              )}
            </article>
          ))
        )}
      </section>
      {model.invitations.length > 0 && (
        <section className="account-list">
          <h2>待使用的邀请</h2>
          {model.invitations.map((invite) => (
            <div className="account-invite-row" key={invite.id}>
              <div>
                <strong>
                  {invite.username ? `@${invite.username}` : "分享邀请"}
                </strong>
                <span>
                  {roleLabels[invite.role]} ·{" "}
                  {new Date(invite.expiresAt).toLocaleString("zh-CN")} 到期
                </span>
              </div>
              <Button
                variant="ghost"
                disabled={model.pending}
                onClick={() => void model.revoke(invite.id)}
              >
                撤销邀请
              </Button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
