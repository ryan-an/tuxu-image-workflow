import { useEffect, useState } from "react";
import { createApplicationController } from "../../application/controller.js";
import {
  authenticationRequired,
  getSession,
  logout,
} from "../../services/authentication";
import { Application } from "../Application";
import { StatusSpinner } from "../StatusSpinner";
import { LoginPage } from "./LoginPage";

function Workspace({ onLogout }: { onLogout?: () => Promise<void> }) {
  const [controller] = useState(createApplicationController);
  useEffect(() => {
    void controller.start();
    return () => controller.dispose();
  }, [controller]);
  return <Application controller={controller} onLogout={onLogout} />;
}

function SessionRouter() {
  const [status, setStatus] = useState<
    "checking" | "authenticated" | "anonymous" | "error"
  >("checking");
  const [attempt, setAttempt] = useState(0);

  function signedOut() {
    window.history.replaceState(null, "", "/login");
    setStatus("anonymous");
  }

  useEffect(() => {
    let active = true;
    void getSession()
      .then((authenticated) => {
        if (!active) return;
        if (authenticated) {
          if (window.location.pathname === "/login")
            window.history.replaceState(null, "", "/");
          setStatus("authenticated");
        } else signedOut();
      })
      .catch(() => {
        if (active) setStatus("error");
      });
    window.addEventListener(authenticationRequired, signedOut);
    return () => {
      active = false;
      window.removeEventListener(authenticationRequired, signedOut);
    };
  }, [attempt]);

  useEffect(() => {
    document.title =
      status === "anonymous" ? "登录 · 图序" : "图序 · 批量生图工作台";
  }, [status]);

  if (status === "checking")
    return (
      <div className="startup" role="status">
        <StatusSpinner />
        正在打开图序…
      </div>
    );
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
  if (status === "anonymous")
    return (
      <LoginPage
        onLogin={() => {
          window.history.replaceState(null, "", "/");
          setStatus("authenticated");
        }}
      />
    );
  return (
    <Workspace
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
