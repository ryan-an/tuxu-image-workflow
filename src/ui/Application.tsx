import type { ApplicationController } from "./types";
import type { ReactNode } from "react";
import { Component, useState, useSyncExternalStore } from "react";
import {
  ApplicationContext,
  ActionButton,
  useApplication,
} from "./context.tsx";
import { Sidebar } from "./products/Sidebar.tsx";
import { Workbench, BatchBar } from "./workbench/Workbench.tsx";
import { QueueDashboard } from "./queue/QueueDashboard.tsx";
import { SheetPanel } from "./sheet/SheetPanel.tsx";
import { DialogHost } from "./dialogs/DialogHost.tsx";
import { AssistantDock } from "./assistant/AssistantDock.tsx";
import { Badge } from "./design-system/Badge";

function TopBar({ onLogout }: { onLogout?: () => Promise<void> }) {
  const { state, ui, controller } = useApplication();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const missingKeys = [
    ...(!ui.hasPromptKey ? ["豆包"] : []),
    ...(!ui.hasKey ? ["Grsai"] : []),
  ];
  const keyStatus = missingKeys.length
    ? `未设置${missingKeys.join("、")} API Key`
    : "已填 API Key";
  return (
    <header className="topbar">
      <nav>
        {[
          ["workbench", "图片工作台"],
          ["sheet", "表格预览 / 导入"],
          ["queue", "执行队列"],
        ].map(([view, label]) => (
          <ActionButton
            key={view}
            className={ui.view === view ? "active" : ""}
            action="view"
            data={{ view }}
          >
            {label}
            {view === "queue" && (
              <>
                {" "}
                <Badge tone="brand" id="queue-count">
                  {
                    state.jobs.filter((j) =>
                      ["queued", "running"].includes(j.status),
                    ).length
                  }
                </Badge>
              </>
            )}
          </ActionButton>
        ))}
      </nav>
      <div className="top-actions">
        <span id="save-status" role="status">
          {ui.saveStatus.startsWith("已保存") && (
            <i className="save-status-dot" aria-hidden="true" />
          )}
          {ui.saveStatus}
        </span>
        {ui.saveStatus.startsWith("保存失败") && (
          <ActionButton id="retry-save" action="save">
            重试保存
          </ActionButton>
        )}
        <ActionButton
          id="settings-button"
          action="settings"
          title={`密钥、模型与生成设置\n豆包 API Key：${ui.hasPromptKey ? "已填写" : "未设置"}\nGrsai API Key：${ui.hasKey ? "已填写" : "未设置"}`}
        >
          设置
          <Badge
            className="settings-key-status"
            tone={missingKeys.length ? "danger" : "success"}
            icon={<i className="settings-key-dot" aria-hidden="true" />}
          >
            {keyStatus}
          </Badge>
        </ActionButton>
        {onLogout && (
          <>
            {logoutError && (
              <span className="logout-error" role="alert">
                {logoutError}
              </span>
            )}
            <button
              id="logout"
              type="button"
              disabled={loggingOut}
              onClick={async () => {
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
              }}
            >
              {loggingOut ? "正在退出…" : "退出登录"}
            </button>
          </>
        )}
      </div>
    </header>
  );
}
export function Application({
  controller,
  onLogout,
}: {
  controller: ApplicationController;
  onLogout?: () => Promise<void>;
}) {
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  if (!snapshot.ready && snapshot.error)
    return (
      <div className="startup">
        <h2>工作台加载失败</h2>
        <p>{snapshot.error}</p>
        <button onClick={() => location.reload()}>重新打开</button>
      </div>
    );
  if (!snapshot.ready)
    return <div className="startup">图序正在打开工作台…</div>;
  return (
    <ApplicationContext.Provider value={{ ...snapshot, controller }}>
      <div id="app">
        <Sidebar />
        <div className="app-main">
          <TopBar onLogout={onLogout} />
          <main id="content">
            <section
              id="workbench-section"
              hidden={snapshot.ui.view !== "workbench"}
            >
              <div id="workbench-content">
                <Workbench />
              </div>
            </section>
            <section id="queue-section" hidden={snapshot.ui.view !== "queue"}>
              <div id="queue-content">
                <QueueDashboard />
              </div>
            </section>
            <SheetPanel />
          </main>
          <BatchBar />
        </div>
      </div>
      <div
        id="toast"
        className={snapshot.ui.toast ? "visible" : ""}
        role="status"
      >
        {snapshot.ui.toast}
      </div>
      <DialogHost />
      <AssistantDock />
      <input
        type="file"
        accept="image/*"
        id="image-input"
        hidden
        multiple
        onChange={controller.uploadFiles}
      />
      <input
        type="file"
        accept="application/json,.json"
        id="restore-input"
        hidden
        onChange={controller.restoreBackup}
      />
    </ApplicationContext.Provider>
  );
}
export class ApplicationErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <div className="startup">
        <h2>工作台显示异常</h2>
        <p>{this.state.error.message}</p>
        <button onClick={() => location.reload()}>重新打开</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
