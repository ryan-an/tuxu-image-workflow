import { useEffect, useState } from "react";
import { queueProgress } from "../../shared/queue-progress.js";
import {
  queueProgressPage,
  type QueueProgressPage,
} from "../services/queue-progress";
import type { Workspace } from "../ui/types";

export function useQueueProgress(
  state: Workspace,
  page: number,
  status: string,
  search: string,
) {
  const [data, setData] = useState<QueueProgressPage>();
  const [loadedQuery, setLoadedQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const demo = state.settings.mode === "demo";
  const query = JSON.stringify([page, status, search]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const timer = setTimeout(async () => {
      try {
        const result = demo
          ? queueProgress(state, page, status, search)
          : await queueProgressPage(page, status, search);
        if (!cancelled) {
          setData(result);
          setLoadedQuery(query);
        }
      } catch (reason) {
        if (!cancelled)
          setError(
            reason instanceof Error ? reason.message : "产品进度加载失败",
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    state.syncCursor,
    state.products,
    state.jobs,
    state.paused,
    state.concurrency,
    demo,
    page,
    status,
    search,
    revision,
  ]);
  return {
    data,
    products: loadedQuery === query ? data?.products || [] : [],
    loading,
    error,
    retry: () => setRevision((value) => value + 1),
  };
}
