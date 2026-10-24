import { useEffect, useRef, useState } from "react";
import type { WorkspaceSummary } from "../../shared/access";
import {
  listWorkspaces,
  createWorkspace,
  renameWorkspace,
  archiveWorkspace,
  leaveWorkspace,
} from "../services/workspaces";

export function useWorkspaces({ enabled = true } = {}) {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]),
    [loading, setLoading] = useState(enabled),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const busy = useRef(false),
    mounted = useRef(true);
  async function refresh() {
    const result = await listWorkspaces();
    if (mounted.current) setWorkspaces(result);
  }
  useEffect(() => {
    mounted.current = true;
    if (!enabled) return;
    void refresh()
      .catch((e) => {
        if (mounted.current) setError(e.message);
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
    return () => {
      mounted.current = false;
    };
  }, [enabled]);
  async function run(work?: () => Promise<unknown>) {
    if (busy.current) return false;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      if (work) await work();
      await refresh();
      return true;
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : "操作失败");
      return false;
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }
  return {
    workspaces,
    loading,
    pending,
    error,
    create: async (name: string): Promise<string | null> => {
      let id: string | null = null;
      const ok = await run(async () => {
        id = (await createWorkspace(name)).id;
      });
      return ok ? id : null;
    },
    refresh: () => run(),
    clearError: () => setError(""),
    rename: (id: string, name: string) => run(() => renameWorkspace(id, name)),
    archive: (id: string, archived: boolean) =>
      run(() => archiveWorkspace(id, archived)),
    leave: (id: string) => run(() => leaveWorkspace(id)),
  };
}
export type WorkspaceDirectoryModel = ReturnType<typeof useWorkspaces>;
