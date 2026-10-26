import { api } from "./workspace-client.js";
import type { Product, Job } from "../ui/types";
import type { productQueueInfo } from "../../shared/queue-progress.js";

export interface QueueProgressRow {
  product: Product;
  info: ReturnType<typeof productQueueInfo>;
  active: boolean;
  retryable: number;
  recovery?: Job;
}
export interface QueueProgressPage {
  products: QueueProgressRow[];
  summary: {
    products: number;
    slots: number;
    generated: number;
    completeProducts: number;
    activeProducts: number;
    attentionProducts: number;
    selected: number;
    working: number;
    pending: number;
    failed: number;
    interrupted: number;
    retryable: number;
    jobTotal: number;
    paused: boolean;
    concurrency: number;
  };
  total: number;
  page: number;
  pages: number;
  pageSize: number;
}
export function queueProgressPage(
  page: number,
  status: string,
  search: string,
): Promise<QueueProgressPage> {
  return api(
    `/api/queue/products?${new URLSearchParams({ page: String(page), status, search: search.slice(0, 500) })}`,
  );
}
