import type { ApplicationController } from "./types";
import type { ReactNode } from "react";
import { Component, useSyncExternalStore } from "react";
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

function TopBar() {
  const { state, ui } = useApplication();
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
                <b id="queue-count">
                  {
                    state.jobs.filter((j) =>
                      ["queued", "running"].includes(j.status),
                    ).length
                  }
                </b>
              </>
            )}
          </ActionButton>
        ))}
      </nav>
      <div className="top-actions">
        <span id="save-status">{ui.saveStatus}</span>
        <ActionButton id="save" action="save">
          保存
        </ActionButton>
        <ActionButton
          id="key-button"
          action="key-settings"
          title="配置 Grsai API 密钥"
        >
          {ui.hasKey ? "密钥已配置" : "密钥设置"}
        </ActionButton>
        <ActionButton id="models-button" action="settings">
          模型设置
        </ActionButton>
        <ActionButton id="mode-button" action="settings">
          {state.settings.mode === "demo"
            ? "◉ 演示模式"
            : `◉ Grsai ${ui.hasKey ? "已配置" : "待填密钥"}`}
        </ActionButton>
      </div>
    </header>
  );
}
export function Application({
  controller,
}: {
  controller: ApplicationController;
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
          <TopBar />
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
