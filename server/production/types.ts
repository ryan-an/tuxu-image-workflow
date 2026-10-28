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
  promptRequirements?: string | null;
  photo: string;
  photos: string[];
  tasks: Position[];
  promptSets: any[];
  photoThumbnail?: any;
}
export interface Job {
  rateLimitUntil?: number;
  rateLimitRetries?: number;
  analysisPhase?: "preparing" | "requesting" | "streaming";
  timings?: {
    attemptStartedAt: number;
    requestStartedAt?: number;
    firstTokenAt?: number;
    completedAt?: number;
    imageCount?: number;
    imageBytes?: number;
  };
  createdBy?: {
    id: string;
    username: string;
    displayName: string;
    systemRole?: "user" | "super_admin";
    accessMode?: "member" | "admin";
  };
  lastRetriedBy?: {
    id: string;
    username: string;
    displayName: string;
    systemRole?: "user" | "super_admin";
    accessMode?: "member" | "admin";
  };
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
  analysisResponse?: string;
  promptWarnings?: {
    code: string;
    role: string;
    message: string;
    actual: number;
    min: number;
    max: number;
  }[];
  validationError?: { code: string; role?: string };
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
  promptConcurrency?: number;
  queryConcurrency?: number;
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
    public diagnostic?: Record<string, unknown>,
  ) {
    super(message);
  }
}
