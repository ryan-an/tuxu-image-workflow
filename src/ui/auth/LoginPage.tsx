import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { login } from "../../services/authentication";
import { StatusSpinner } from "../StatusSpinner";
import "./login.css";

export function LoginPage({ onLogin }: { onLogin(): void }) {
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const fields = new FormData(event.currentTarget);
    submitting.current = true;
    setPending(true);
    setError("");
    try {
      await login(
        String(fields.get("username")).trim(),
        String(fields.get("password")),
      );
      onLogin();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "暂时无法登录，请稍后重试",
      );
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-story" aria-label="图序工作台">
        <div className="brand login-brand">
          <span>图</span>
          <div>
            <strong>图序</strong>
            <small>批量生图工作台</small>
          </div>
        </div>
        <div className="login-story-content">
          <span className="login-eyebrow">为产品图片创作，理清每一步</span>
          <h1>
            从一张实拍，
            <br />
            到一整套产品图。
          </h1>
          <p>
            整理产品、编写提示词、批量生成。
            <br />
            让创作在同一个工作台里，有序展开。
          </p>
          <div className="login-workflow" aria-hidden="true">
            <div className="login-preview">
              <div className="login-product-art">
                <i />
                <i />
                <i />
              </div>
              <span>产品素材</span>
            </div>
            <span className="login-connector">→</span>
            <div className="login-preview login-preview-prompt">
              <div className="login-prompt-art">
                <i />
                <i />
                <i />
                <i />
              </div>
              <span>整套提示词</span>
            </div>
            <span className="login-connector">→</span>
            <div className="login-preview">
              <div className="login-results-art">
                <i />
                <i />
                <i />
                <i />
              </div>
              <span>成套产品图</span>
            </div>
          </div>
        </div>
        <div className="login-story-footer">
          <i /> 你的产品、素材与创作记录，集中在这里。
        </div>
      </section>
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-form-container">
          <span className="login-form-eyebrow">欢迎回来</span>
          <h2 id="login-title">登录图序</h2>
          <p className="login-description">继续你的产品图片工作流</p>
          <form id="login-form" onSubmit={submit} aria-busy={pending}>
            <label htmlFor="login-username">用户名</label>
            <input
              id="login-username"
              name="username"
              autoComplete="username"
              defaultValue="admin"
              required
              maxLength={100}
              disabled={pending}
            />
            <label htmlFor="login-password">密码</label>
            <div className="login-password-field">
              <input
                id="login-password"
                name="password"
                type={visible ? "text" : "password"}
                autoComplete="current-password"
                placeholder="请输入登录密码"
                required
                maxLength={4096}
                disabled={pending}
                aria-describedby={error ? "login-error" : "login-hint"}
                aria-invalid={!!error}
              />
              <button
                type="button"
                className="login-password-toggle"
                aria-label={visible ? "隐藏密码" : "显示密码"}
                aria-pressed={visible}
                onClick={() => setVisible(!visible)}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  aria-hidden="true"
                >
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                  <circle cx="12" cy="12" r="3" />
                  {visible && <path d="m3 3 18 18" />}
                </svg>
              </button>
            </div>
            <div className="login-feedback" aria-live="polite">
              {error && (
                <p id="login-error" role="alert">
                  {error}
                </p>
              )}
            </div>
            <button type="submit" className="login-submit" disabled={pending}>
              {pending ? (
                <>
                  <StatusSpinner />
                  正在登录…
                </>
              ) : (
                <>
                  登录工作台 <span aria-hidden="true">→</span>
                </>
              )}
            </button>
            <p id="login-hint" className="login-hint">
              使用本机启动时显示的用户名和登录密码。
            </p>
          </form>
          <div className="login-form-footer">
            <span /> 登录后，接着上一次的创作。
          </div>
        </div>
      </section>
    </main>
  );
}
