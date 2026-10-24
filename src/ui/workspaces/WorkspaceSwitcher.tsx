import { useId, useRef, useState } from "react";
import type { CurrentUser } from "../../../shared/access";
import { roleLabels } from "../../../shared/access";
import type { WorkspaceDirectoryModel } from "../../application/use-workspaces";
import { openWorkspace } from "../../services/workspaces";
import "./workspaces.css";

export function WorkspaceSwitcher({
  user,
  model,
  flush,
  onManage,
  onCreate,
}: {
  user: CurrentUser;
  model: WorkspaceDirectoryModel;
  flush(): Promise<unknown>;
  onManage(): void;
  onCreate(): void;
}) {
  const id = useId(),
    trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null),
    busy = useRef(false);
  const [open, setOpen] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [position, setPosition] = useState({
      left: 12,
      top: 70,
      width: 296,
      maxHeight: 500,
    });
  const active = model.workspaces.filter((space) => !space.archivedAt);
  const spaces = active.some((space) => space.id === user.workspaceId)
    ? active
    : [
        {
          id: user.workspaceId,
          name: user.workspaceName,
          role: user.role,
          memberCount: 0,
          createdAt: 0,
          archivedAt: null,
        },
        ...active,
      ];
  function positionMenu() {
    const rect = trigger.current!.getBoundingClientRect(),
      width = Math.min(296, window.innerWidth - 24);
    setPosition({
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      top: rect.bottom + 8,
      width,
      maxHeight: Math.max(180, window.innerHeight - rect.bottom - 24),
    });
  }
  function close() {
    menu.current?.hidePopover();
  }
  async function select(workspaceId: string) {
    close();
    if (workspaceId === user.workspaceId || busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      await openWorkspace(workspaceId, flush);
    } catch (e) {
      setError((e as Error).message);
      busy.current = false;
      setPending(false);
    }
  }
  function focusFirst() {
    positionMenu();
    menu.current?.showPopover();
    menu.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
  }
  return (
    <div className="workspace-switcher">
      <button
        ref={trigger}
        className="workspace-switcher-trigger"
        aria-label={`切换工作区：${user.workspaceName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        popoverTarget={id}
        disabled={pending}
        onClick={() => {
          positionMenu();
          if (!open && !model.pending) void model.refresh();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            focusFirst();
          }
        }}
      >
        <span className="workspace-switcher-avatar" aria-hidden="true">
          {user.workspaceName.slice(0, 1)}
        </span>
        <span className="workspace-switcher-title">
          <small>当前工作区</small>
          <strong>{user.workspaceName}</strong>
        </span>
        <svg
          className={open ? "is-open" : ""}
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="m6 8 4 4 4-4" />
        </svg>
      </button>
      <div
        id={id}
        ref={menu}
        popover="auto"
        className="workspace-menu"
        role="menu"
        aria-label="工作区列表"
        style={position}
        onToggle={() =>
          setOpen(menu.current?.matches(":popover-open") || false)
        }
        onKeyDown={(event) => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          const items = Array.from(
              menu.current!.querySelectorAll<HTMLButtonElement>(
                "button:not(:disabled)",
              ),
            ),
            index = items.indexOf(document.activeElement as HTMLButtonElement);
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? items.length - 1
                : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) %
                  items.length;
          items[next]?.focus();
        }}
      >
        <div className="workspace-menu-heading">
          切换工作区 <span>{spaces.length}</span>
        </div>
        <div className="workspace-menu-list">
          {spaces.map((space) => (
            <button
              key={space.id}
              role="menuitemradio"
              aria-checked={space.id === user.workspaceId}
              className={`workspace-menu-option ${space.id === user.workspaceId ? "is-current" : ""}`}
              disabled={pending || model.pending}
              onClick={() => void select(space.id)}
            >
              <span className="workspace-menu-avatar" aria-hidden="true">
                {space.name.slice(0, 1)}
              </span>
              <span className="workspace-menu-info">
                <strong>{space.name}</strong>
                <small>
                  {roleLabels[space.role]}
                  {space.memberCount ? ` · ${space.memberCount} 位成员` : ""}
                </small>
              </span>
              {space.id === user.workspaceId && (
                <svg
                  className="workspace-menu-check"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <path d="m4 10 4 4 8-8" />
                </svg>
              )}
            </button>
          ))}
        </div>
        <div className="workspace-menu-footer">
          <button
            role="menuitem"
            onClick={() => {
              close();
              onManage();
            }}
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="5" height="5" rx="1" />
              <rect x="12" y="3" width="5" height="5" rx="1" />
              <rect x="3" y="12" width="5" height="5" rx="1" />
              <rect x="12" y="12" width="5" height="5" rx="1" />
            </svg>
            工作区管理
          </button>
          <button
            role="menuitem"
            className="workspace-menu-create"
            onClick={() => {
              close();
              onCreate();
            }}
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <path d="M10 4v12M4 10h12" />
            </svg>
            新建工作区
          </button>
        </div>
      </div>
      {(error || model.error) && (
        <p className="workspace-switcher-error" role="alert">
          {error || model.error}
        </p>
      )}
    </div>
  );
}
