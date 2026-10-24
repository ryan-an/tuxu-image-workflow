import { useEffect, useRef, useState } from "react";
import type {
  CurrentUser,
  UserIdentity,
  WorkspaceInvitation,
} from "../../../shared/access";
import { roleLabels } from "../../../shared/access";
import {
  acceptInvitation,
  getInvitation,
  login,
} from "../../services/authentication";
import "./login.css";

export function InvitationPage({
  token,
  account,
  onLogin,
}: {
  token: string;
  account: UserIdentity | null;
  onLogin(user: CurrentUser): void;
}) {
  const [invitation, setInvitation] = useState<WorkspaceInvitation | null>(
      null,
    ),
    [loading, setLoading] = useState(true),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [loginMode, setLoginMode] = useState(false);
  const busy = useRef(false);
  useEffect(() => {
    let active = true;
    void getInvitation(token)
      .then((result) => {
        if (active) setInvitation(result);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);
  const activation = !!invitation?.accountId && !invitation.requiresLogin;
  const signedIn =
    !!account &&
    !activation &&
    (!invitation?.accountId || invitation.accountId === account.id);
  const signingIn =
    !signedIn && !activation && (loginMode || !!invitation?.requiresLogin);
  return (
    <main className="login-page invitation-page">
      <section className="login-panel" aria-labelledby="invitation-title">
        <div className="login-form-container">
          <span className="login-form-eyebrow">图序 · 工作区邀请</span>
          <h2 id="invitation-title">
            {signedIn
              ? "加入工作区"
              : signingIn
                ? "登录并加入"
                : "设置密码并加入"}
          </h2>
          {loading ? (
            <p role="status">正在检查邀请…</p>
          ) : invitation ? (
            <>
              <p className="login-description">
                {invitation.displayName ? `${invitation.displayName}，` : ""}
                你将以{roleLabels[invitation.role]}身份加入「
                {invitation.workspaceName}」。
              </p>
              <form
                className="login-form"
                aria-busy={pending}
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (busy.current) return;
                  const data = new FormData(e.currentTarget),
                    password = String(data.get("password") || "");
                  if (
                    !signedIn &&
                    !signingIn &&
                    password !== data.get("confirmPassword")
                  ) {
                    setError("两次密码不一致");
                    return;
                  }
                  busy.current = true;
                  setPending(true);
                  setError("");
                  try {
                    if (signingIn)
                      await login(String(data.get("username")), password);
                    const result = await acceptInvitation(
                      token,
                      signedIn || signingIn
                        ? {}
                        : {
                            password,
                            ...(!activation
                              ? {
                                  username: String(data.get("username")),
                                  ...(data.get("displayName")
                                    ? {
                                        displayName: String(
                                          data.get("displayName"),
                                        ),
                                      }
                                    : {}),
                                }
                              : {}),
                          },
                    );
                    if (result.user) onLogin(result.user);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "加入失败");
                  } finally {
                    busy.current = false;
                    setPending(false);
                  }
                }}
              >
                {signedIn ? (
                  <p className="invitation-identity">
                    当前账号 <strong>{account!.displayName}</strong>{" "}
                    <span>@{account!.username}</span>
                  </p>
                ) : (
                  <>
                    <label htmlFor="invite-username">用户名</label>
                    <input
                      id="invite-username"
                      name="username"
                      autoComplete="username"
                      readOnly={!!invitation.username}
                      defaultValue={invitation.username || ""}
                      placeholder="3～40 位字母或数字"
                      required
                      minLength={3}
                      maxLength={40}
                      disabled={pending}
                    />
                    {!activation && !signingIn && (
                      <>
                        <label htmlFor="invite-name">名称</label>
                        <input
                          id="invite-name"
                          name="displayName"
                          autoComplete="nickname"
                          placeholder="你的名字（可选）"
                          maxLength={60}
                          disabled={pending}
                        />
                      </>
                    )}
                    <label htmlFor="invite-password">
                      {signingIn ? "密码" : "设置密码"}
                    </label>
                    <input
                      id="invite-password"
                      name="password"
                      type="password"
                      required
                      minLength={signingIn ? 1 : 10}
                      maxLength={256}
                      autoComplete={
                        signingIn ? "current-password" : "new-password"
                      }
                      placeholder={
                        signingIn ? "请输入登录密码" : "至少 10 个字符"
                      }
                      disabled={pending}
                    />
                    {!signingIn && (
                      <>
                        <label htmlFor="invite-confirm">确认密码</label>
                        <input
                          id="invite-confirm"
                          name="confirmPassword"
                          type="password"
                          required
                          minLength={10}
                          maxLength={256}
                          autoComplete="new-password"
                          placeholder="再次输入密码"
                          disabled={pending}
                        />
                      </>
                    )}
                  </>
                )}
                {error && (
                  <p className="error-text" role="alert">
                    {error}
                  </p>
                )}
                <button
                  type="submit"
                  className="login-submit"
                  disabled={pending}
                >
                  {pending
                    ? "正在加入…"
                    : signedIn
                      ? "确认加入"
                      : signingIn
                        ? "登录并加入"
                        : "加入工作区"}
                </button>
              </form>
              {!activation && !signedIn && !invitation.requiresLogin && (
                <p className="login-hint">
                  <button
                    className="invitation-mode-toggle"
                    onClick={() => {
                      setLoginMode(!loginMode);
                      setError("");
                    }}
                  >
                    {signingIn
                      ? "没有账号，通过邀请创建"
                      : "已有账号，登录后加入"}
                  </button>
                </p>
              )}
              {account && !signedIn && invitation.requiresLogin && (
                <p className="login-hint">
                  请使用受邀账号登录，加入后保留其原有工作区。
                </p>
              )}
            </>
          ) : (
            <p className="error-text" role="alert">
              {error || "邀请链接不完整，请获取新链接。"}
            </p>
          )}
          <p className="login-hint">
            <a href="/login">返回登录</a>
          </p>
        </div>
      </section>
    </main>
  );
}
