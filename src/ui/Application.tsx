import { TopBar } from "./TopBar";
import { WorkspaceLoading } from "./WorkspaceLoading";
import type { ApplicationController } from "./types";
import type { ReactNode } from "react";
import { Component, useState, useSyncExternalStore } from "react";
import { ApplicationContext } from "./context.tsx";
import { Sidebar } from "./products/Sidebar.tsx";
import { Workbench, BatchBar } from "./workbench/Workbench.tsx";
import { QueueDashboard } from "./queue/QueueDashboard.tsx";
import { SheetPanel } from "./sheet/SheetPanel.tsx";
import { DialogHost } from "./dialogs/DialogHost.tsx";
import { AssistantDock } from "./assistant/AssistantDock.tsx";

import type { CurrentUser } from "../../shared/access";
import { MembersPage } from "./members/MembersPage";

import { WorkspaceManager } from "./workspaces/WorkspaceManager";
import { CreateWorkspaceDialog } from "./workspaces/CreateWorkspaceDialog";
import { useWorkspaces } from "../application/use-workspaces";
import { openWorkspace } from "../services/workspaces";

export function Application({
  controller,
  onLogout,
  user = {
    id: "owner",
    username: "admin",
    displayName: "所有者",
    workspaceId: "default",
    workspaceName: "默认团队",
    role: "owner",
  },
}: {
  controller: ApplicationController;
  onLogout?: () => Promise<void>;
  user?: CurrentUser;
}) {
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const workspaces = useWorkspaces({
    enabled: import.meta.env.MODE !== "demo",
  });
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const workspaceUser = {
    ...user,
    workspaceName:
      workspaces.workspaces.find((space) => space.id === user.workspaceId)
        ?.name || user.workspaceName,
  };
  if (!snapshot.ready && snapshot.error)
    return (
      <div className="startup">
        <h2>工作台加载失败</h2>
        <p>{snapshot.error}</p>
        <button onClick={() => location.reload()}>重新打开</button>
      </div>
    );
  if (!snapshot.ready) return <WorkspaceLoading />;
  return (
    <ApplicationContext.Provider
      value={{ ...snapshot, controller, user: workspaceUser }}
    >
      <div id="app">
        <Sidebar
          workspaces={workspaces}
          onCreateWorkspace={() => setCreatingWorkspace(true)}
        />
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
            {snapshot.ui.view === "members" && user.role === "owner" && (
              <MembersPage />
            )}
            {snapshot.ui.view === "workspaces" && (
              <WorkspaceManager
                model={workspaces}
                currentWorkspaceId={user.workspaceId}
                currentWorkspaceName={workspaceUser.workspaceName}
                onCreate={() => setCreatingWorkspace(true)}
                onBack={() =>
                  void controller.dispatch("view", { view: "workbench" })
                }
                onOpen={(id) =>
                  id === user.workspaceId
                    ? controller.dispatch("view", { view: "workbench" })
                    : openWorkspace(id, () => controller.flush())
                }
                beforeChange={() => controller.flush()}
                onUnavailable={() => window.location.assign("/?manage=1")}
              />
            )}
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
      {creatingWorkspace && (
        <CreateWorkspaceDialog
          model={workspaces}
          onClose={() => setCreatingWorkspace(false)}
          beforeCreate={() => controller.flush()}
          onCreated={(id) => openWorkspace(id)}
        />
      )}
      {user.role !== "viewer" && <AssistantDock />}
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
