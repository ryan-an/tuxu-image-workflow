export type Status =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";
export interface Position {
  id: string;
  role: string;
  references: string[];
  prompt: string;
  revision: number;
  promptHistory: any[];
  versions: any[];
  selectedIds: string[];
  primaryId: string | null;
  realPhotoIndices?: number[];
  promptSetId?: string;
}
export interface Product {
  id: string;
  code: string;
  name: string;
  facts: string;
  photo: string;
  photos: string[];
  tasks: Position[];
  promptSets: any[];
  photoThumbnail?: any;
}
export interface Job {
  id: string;
  productId: string;
  productName: string;
  taskId?: string;
  taskIds?: string[];
  kind: "prompt-set" | "image";
  status: Status;
  stage: string;
  config: Record<string, any>;
  role: string;
  mode: "live";
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  dependsOn?: string;
  remoteId?: string;
  productSnapshot?: Product;
  common?: string;
  revisions?: Record<string, number>;
  referenceImages?: string[];
  prompt?: string;
  prompts?: any[];
  promptDrafts?: Record<string, string>;
  receivedChars?: number;
  progress?: number;
  error: string;
  owner?: string;
  failures?: number;
  attemptId?: string;
}
export interface Workspace {
  schema: number;
  common: string;
  settings: Record<string, any>;
  concurrency: number;
  paused: boolean;
  activeProductId?: string;
  sheetSnapshot?: any;
  products: Product[];
  jobs: Job[];
  [key: string]: any;
}
export interface Queryable {
  query(
    sql: string,
    values?: any[],
  ): Promise<{ rows: any[]; rowCount?: number | null }>;
}
export interface Database extends Queryable {
  transaction<T>(work: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export class AppError extends Error {
  constructor(
    message: string,
    public statusCode = 400,
  ) {
    super(message);
  }
}
