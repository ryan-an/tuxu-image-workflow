import { useEffect, useState } from "react";
import { createApplicationController } from "../../application/controller.js";
import {
  authenticationRequired,
  getSession,
  logout,
  HttpsRequiredError,
} from "../../services/authentication";
import { Application } from "../Application";
import { WorkspaceLoading } from "../WorkspaceLoading";
import { LoginPage } from "./LoginPage";
import { InvitationPage } from "./InvitationPage";
import type { CurrentUser, UserIdentity } from "../../../shared/access";
import { WorkspaceHome } from "../workspaces/WorkspaceHome";
import { workspaceUrl } from "../../services/workspaces";
import { setSessionWorkspace } from "../../services/session-scope.js";
import { insecureTransportMessage } from "../../../shared/transport-security";
import { AdminConsole } from "../admin/AdminConsole";

function Workspace({
  onLogout,
  user,
  initialView,
}: {
  onLogout?: () => Promise<void>;
  user?: CurrentUser;
  initialView?: string;
}) {
  const [controller] = useState(() =>
    createApplicationController(user, { initialView }),
  );
  useEffect(() => {
    void controller.start();
    return () => controller.dispose();
  }, [controller]);
  return (
    <Application controller={controller} onLogout={onLogout} user={user} />
  );
}

function SessionRouter() {
  const [status, setStatus] = useState<
    "checking" | "authenticated" | "anonymous" | "error" | "https-required"
  >("checking");
  const [attempt, setAttempt] = useState(0);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [account, setAccount] = useState<UserIdentity | null>(null);
  const query = new URLSearchParams(window.location.search);
  const [adminPage] = useState(() => window.location.pathname === "/admin");
  const [invitationToken] = useState(() =>
    window.location.pathname === "/invite"
      ? new URLSearchParams(window.location.hash.slice(1)).get("token") || ""
      : null,
  );

  function signedOut() {
    window.history.replaceState(null, "", "/login");
    setStatus("anonymous");
    setUser(null);
    setAccount(null);
  }

  useEffect(() => {
    let active = true;
    void getSession(
      adminPage ? undefined : query.get("workspace") || undefined,
      !adminPage && query.get("admin") === "1",
    )
      .then(({ authenticated, user, account }) => {
        if (!active) return;
        setAccount(account);
        if (account)
          setSessionWorkspace(
            adminPage ? undefined : user?.workspaceId,
            account.id,
            !adminPage && user?.accessMode === "admin",
          );
        if (invitationToken !== null) {
          setStatus("anonymous");
          return;
        }
        if (authenticated) {
          setUser(user);
          if (user && !adminPage)
            window.history.replaceState(
              null,
              "",
              workspaceUrl(user.workspaceId) +
                (user.accessMode === "admin" ? "&admin=1" : "") +
                (query.has("manage") ? "&manage=1" : ""),
            );
          if (window.location.pathname === "/login")
            window.history.replaceState(null, "", "/");
          setStatus("authenticated");
        } else signedOut();
      })
      .catch((error) => {
        if (active)
          setStatus(
            error instanceof HttpsRequiredError ? "https-required" : "error",
          );
      });
    window.addEventListener(authenticationRequired, signedOut);
    return () => {
      active = false;
      window.removeEventListener(authenticationRequired, signedOut);
    };
  }, [attempt]);

  useEffect(() => {
    document.title =
      status === "anonymous"
        ? "登录 · 图序"
        : adminPage
          ? "超级管理台 · 图序"
          : "图序 · 批量生图工作台";
  }, [status]);

  if (status === "checking") return <WorkspaceLoading title="正在打开图序" />;
  if (status === "error")
    return (
      <div className="startup">
        <h2>暂时无法连接工作台</h2>
        <p>请检查本地服务是否已启动，然后重试。</p>
        <button
          onClick={() => {
            setStatus("checking");
            setAttempt(attempt + 1);
          }}
        >
          重新连接
        </button>
      </div>
    );
  if (status === "https-required")
    return (
      <main className="startup">
        <h2>请使用加密连接</h2>
        <p>{insecureTransportMessage}</p>
        <p>请使用所有者提供的 HTTPS 地址。</p>
      </main>
    );
  if (
    status === "anonymous" &&
    invitationToken !== null &&
    window.location.pathname === "/invite"
  )
    return (
      <InvitationPage
        token={invitationToken}
        account={account}
        onLogin={(user) => {
          window.location.assign(workspaceUrl(user.workspaceId));
        }}
      />
    );
  if (status === "anonymous")
    return (
      <LoginPage
        onLogin={() => window.location.assign(adminPage ? "/admin" : "/")}
      />
    );
  if (adminPage && account) {
    if (account.systemRole !== "super_admin")
      return (
        <main className="startup">
          <h2>无权访问超级管理台</h2>
          <p>当前账号没有系统管理权限。</p>
          <a href="/">返回我的工作台</a>
        </main>
      );
    return <AdminConsole account={account} />;
  }
  if (account && !user) return <WorkspaceHome account={account} />;
  return (
    <Workspace
      key={`${user?.id}:${user?.workspaceId}`}
      user={user || undefined}
      initialView={query.has("manage") ? "workspaces" : undefined}
      onLogout={async () => {
        await logout();
        signedOut();
      }}
    />
  );
}

export function AuthRouter() {
  return import.meta.env.MODE === "demo" ? <Workspace /> : <SessionRouter />;
}
