import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { roleLabels } from "../../shared/access";
import { ActionButton, useApplication } from "./context";
import { Badge } from "./design-system/Badge";
import { Button } from "./design-system/Button";
import { PasswordDialog } from "./auth/PasswordDialog";
import "./topbar.css";

function Icon({
  name,
}: {
  name:
    | "history"
    | "workspaces"
    | "members"
    | "settings"
    | "password"
    | "logout"
    | "chevron"
    | "eye"
    | "retry";
}) {
  const paths: Record<typeof name, ReactNode> = {
    history: (
      <>
        <path d="M3 11a9 9 0 1 1 2.6 7.4M3 4v7h7" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    workspaces: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    members: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        <circle cx="9" cy="7" r="4" />
      </>
    ),
    settings: (
      <>
        <path d="m9.5 3-.7 2.2-2 .9-2.2-.5-2 3.4 1.5 1.7v2.6l-1.5 1.7 2 3.4 2.2-.5 2 .9.7 2.2h5l.7-2.2 2-.9 2.2.5 2-3.4-1.5-1.7v-2.6L21 9l-2-3.4-2.2.5-2-.9L14.5 3z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    password: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
      </>
    ),
    logout: (
      <>
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M9 12h12m-4-4 4 4-4 4" />
      </>
    ),
    chevron: <path d="m7 10 5 5 5-5" />,
    eye: (
      <>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    retry: (
      <path d="M20 7v5h-5M4 17v-5h5M6.1 6.1A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.9 5.9" />
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}

export function TopBar({ onLogout }: { onLogout?: () => Promise<void> }) {
  const { state, ui, controller, user } = useApplication();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const [position, setPosition] = useState({ top: 64, right: 16 });
  const accountId = useId();
  const accountTrigger = useRef<HTMLButtonElement>(null);
  const accountPanel = useRef<HTMLDivElement>(null);
  const missingKeys = [
    ...(!ui.hasPromptKey ? ["豆包"] : []),
    ...(!ui.hasKey ? ["Grsai"] : []),
  ];
  const keyStatus = missingKeys.length
    ? `未设置${missingKeys.join("、")} API Key`
    : "已填 API Key";
  const saved = ui.saveStatus.startsWith("已保存");
  const saveFailed = ui.saveStatus.startsWith("保存失败");

  function positionAccount() {
    const rect = accountTrigger.current!.getBoundingClientRect();
    setPosition({
      top: rect.bottom + 10,
      right: Math.max(12, window.innerWidth - rect.right),
    });
  }
  function closeAccount() {
    accountPanel.current?.hidePopover();
  }
  useEffect(() => {
    if (!accountOpen) return;
    const close = () => accountPanel.current?.hidePopover();
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, [accountOpen]);

  async function logout() {
    if (!onLogout || loggingOut) return;
    setLoggingOut(true);
    setLogoutError("");
    try {
      await controller.flush();
      await onLogout();
    } catch (error) {
      setLogoutError(
        error instanceof Error ? error.message : "退出失败，请重试",
      );
      setLoggingOut(false);
    }
  }

  return (
    <header className="topbar">
      <nav aria-label="工作视图">
        {[
          ["workbench", "图片工作台"],
          ["sheet", "表格预览 / 导入"],
          ["queue", "执行队列"],
        ].map(([view, label]) => (
          <ActionButton
            key={view}
            className={ui.view === view ? "active" : ""}
            aria-current={ui.view === view ? "page" : undefined}
            action="view"
            data={{ view }}
          >
            {label}
            {view === "queue" && (
              <Badge tone="brand" id="queue-count">
                {
                  state.jobs.filter((job) =>
                    ["queued", "running"].includes(job.status),
                  ).length
                }
              </Badge>
            )}
          </ActionButton>
        ))}
      </nav>
      <div className="top-actions">
        <div className="topbar-save" data-failed={saveFailed || undefined}>
          <span
            id="save-status"
            role="status"
            aria-label={user.role === "viewer" ? "只读访问" : ui.saveStatus}
            title={
              user.role === "viewer" ? "当前工作区为只读访问" : ui.saveStatus
            }
          >
            {user.role === "viewer" ? (
              <Icon name="eye" />
            ) : saved ? (
              <i className="save-status-dot" aria-hidden="true" />
            ) : (
              <Icon name="retry" />
            )}
            <span>{user.role === "viewer" ? "只读访问" : ui.saveStatus}</span>
          </span>
          {saveFailed && user.role !== "viewer" && (
            <ActionButton
              id="retry-save"
              action="save"
              variant="ghost"
              size="sm"
            >
              重试保存
            </ActionButton>
          )}
        </div>
        <div className="topbar-tools" role="group" aria-label="工作区工具">
          {import.meta.env.MODE !== "demo" && (
            <>
              <ActionButton
                action="activity"
                variant="ghost"
                size="sm"
                className="topbar-icon-button"
                aria-label="操作历史"
                title="操作历史"
              >
                <Icon name="history" />
              </ActionButton>
              <ActionButton
                action="view"
                data={{ view: "workspaces" }}
                variant="ghost"
                size="sm"
                className={`topbar-icon-button ${ui.view === "workspaces" ? "active" : ""}`}
                aria-label="工作区管理"
                title="工作区管理"
                aria-current={ui.view === "workspaces" ? "page" : undefined}
              >
                <Icon name="workspaces" />
              </ActionButton>
            </>
          )}
          {user.role === "owner" && (
            <ActionButton
              action="view"
              data={{ view: "members" }}
              variant="ghost"
              size="sm"
              className={`topbar-icon-button ${ui.view === "members" ? "active" : ""}`}
              aria-label="成员管理"
              title="成员管理"
              aria-current={ui.view === "members" ? "page" : undefined}
            >
              <Icon name="members" />
            </ActionButton>
          )}
        </div>
        <ActionButton
          id="settings-button"
          action="settings"
          variant="ghost"
          size="sm"
          aria-label={`设置：${keyStatus}`}
          title={`密钥、模型与生成设置\n豆包 API Key：${ui.hasPromptKey ? "已填写" : "未设置"}\nGrsai API Key：${ui.hasKey ? "已填写" : "未设置"}`}
        >
          <Icon name="settings" />
          <span className="settings-label">设置</span>
          <Badge
            className="settings-key-status"
            tone={missingKeys.length ? "danger" : "success"}
            aria-label={keyStatus}
            title={keyStatus}
            icon={<i className="settings-key-dot" aria-hidden="true" />}
          >
            {missingKeys.length ? "待配置" : "已配置"}
          </Badge>
        </ActionButton>
        <div className="topbar-account">
          <Button
            id="account-menu-button"
            ref={accountTrigger}
            className="current-account"
            variant="ghost"
            aria-label="账号菜单"
            title={`${user.displayName} · ${roleLabels[user.role]}`}
            aria-expanded={accountOpen}
            aria-controls={accountId}
            popoverTarget={accountId}
            onClick={positionAccount}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                positionAccount();
                accountPanel.current?.showPopover();
                accountPanel.current
                  ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
                  ?.focus();
              }
            }}
          >
            <span className="account-avatar" aria-hidden="true">
              {Array.from(user.displayName || user.username)[0]?.toUpperCase()}
            </span>
            <span className="account-summary">
              <span className="account-name" title={user.displayName}>
                {user.displayName}
              </span>
              <span className="account-role">{roleLabels[user.role]}</span>
            </span>
            <Icon name="chevron" />
          </Button>
          <div
            id={accountId}
            ref={accountPanel}
            popover="auto"
            className="account-popover"
            role="group"
            aria-label="账号选项"
            style={position}
            onToggle={() =>
              setAccountOpen(
                accountPanel.current?.matches(":popover-open") || false,
              )
            }
          >
            <div className="account-popover-heading">
              <strong>{user.displayName}</strong>
              <span title={user.username}>@{user.username}</span>
              <Badge tone="neutral">{roleLabels[user.role]}</Badge>
            </div>
            {user.id !== "owner" && (
              <Button
                variant="ghost"
                onClick={() => {
                  closeAccount();
                  setPasswordOpen(true);
                }}
              >
                <Icon name="password" />
                修改密码
              </Button>
            )}
            {onLogout && (
              <Button
                id="logout"
                variant="ghost"
                disabled={loggingOut}
                onClick={() => void logout()}
              >
                <Icon name="logout" />
                {loggingOut ? "正在退出…" : "退出登录"}
              </Button>
            )}
            {logoutError && (
              <p className="account-logout-error" role="alert">
                {logoutError}
              </p>
            )}
          </div>
        </div>
      </div>
      {passwordOpen && (
        <PasswordDialog onClose={() => setPasswordOpen(false)} />
      )}
    </header>
  );
}
