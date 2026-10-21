import { useEffect, useState } from "react";
import { jobHistory, type JobHistoryPage } from "../services/job-history";
import type { Job } from "../ui/types";

export function useJobHistory(
  jobs: Job[],
  demo: boolean,
  enabled: boolean,
  page: number,
  status: string,
  search: string,
) {
  const [data, setData] = useState<JobHistoryPage>({
    jobs: [],
    total: 0,
    page: 1,
    pageSize: 50,
    pages: 1,
  });
  const [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    async function read() {
      if (!demo) return jobHistory(page, status, search);
      const filtered = jobs
        .filter(
          (job) =>
            (status === "all" ||
              (status === "active" &&
                ["queued", "running"].includes(job.status)) ||
              (status === "attention" &&
                ["failed", "interrupted"].includes(job.status)) ||
              job.status === status) &&
            `${job.productName} ${job.role} ${job.remoteId || ""} ${job.error || ""}`
              .toLowerCase()
              .includes(search.trim().toLowerCase()),
        )
        .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
      const pages = Math.max(1, Math.ceil(filtered.length / 50)),
        current = Math.min(page, pages);
      return {
        jobs: filtered.slice((current - 1) * 50, current * 50),
        total: filtered.length,
        page: current,
        pageSize: 50,
        pages,
      };
    }
    void read()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((reason) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : "任务加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [jobs, demo, enabled, page, status, search, revision]);
  return {
    ...data,
    loading,
    error,
    retry: () => setRevision((value) => value + 1),
  };
}
