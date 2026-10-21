import { api } from "./workspace-client.js";
import type { Job } from "../ui/types";
export interface JobHistoryPage {
  jobs: Job[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}
export function jobHistory(
  page: number,
  status: string,
  search: string,
): Promise<JobHistoryPage> {
  return api(
    `/api/jobs/history?${new URLSearchParams({ page: String(page), pageSize: "50", status, search: search.slice(0, 500) })}`,
  );
}
