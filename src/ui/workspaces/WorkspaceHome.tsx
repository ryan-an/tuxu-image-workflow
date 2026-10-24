import { useState } from "react";
import type { UserIdentity } from "../../../shared/access";
import { useWorkspaces } from "../../application/use-workspaces";
import { openWorkspace } from "../../services/workspaces";
import { logout } from "../../services/authentication";
import { Button } from "../design-system/Button";
import { PasswordDialog } from "../auth/PasswordDialog";
import { WorkspaceManager } from "./WorkspaceManager";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";
import "./workspaces.css";

// Only used when the account has no accessible workspace to populate a sidebar.
export function WorkspaceHome({ account }: { account: UserIdentity }) {
  const model = useWorkspaces(),
    [passwordOpen, setPasswordOpen] = useState(false),
    [creating, setCreating] = useState(false),
    [error, setError] = useState("");
  return (
    <main className="workspace-home">
      <header className="workspace-home-header">
        <a className="workspace-brand" href="/">
          图序<span>批量生图工作台</span>
        </a>
        <div>
          <span>
            {account.displayName} · @{account.username}
          </span>
          {account.id !== "owner" && (
            <Button variant="secondary" onClick={() => setPasswordOpen(true)}>
              修改密码
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                await logout();
                window.location.assign("/login");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            退出登录
          </Button>
        </div>
      </header>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <WorkspaceManager
        model={model}
        onCreate={() => setCreating(true)}
        onOpen={(id) => openWorkspace(id)}
      />
      {creating && (
        <CreateWorkspaceDialog
          model={model}
          onClose={() => setCreating(false)}
          onCreated={(id) => openWorkspace(id)}
        />
      )}
      {passwordOpen && (
        <PasswordDialog onClose={() => setPasswordOpen(false)} />
      )}
    </main>
  );
}
