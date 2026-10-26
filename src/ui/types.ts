import type { ChangeEvent, FormEvent } from "react";
import type { CurrentUser } from "../../shared/access.js";

export interface ImageVersion {
  id: string;
  source: string;
  prompt: string;
  origin: string;
  createdAt: number;
  number: number;
}
export interface PromptVersion {
  id?: string;
  prompt: string;
  createdAt: number;
}
export interface ImageTask {
  versionCount?: number;
  id: string;
  role: string;
  references: string[];
  prompt: string;
  promptHistory: PromptVersion[];
  versions: ImageVersion[];
  selectedIds: string[];
  primaryId: string | null;
  revision: number;
}
export interface Product {
  _summary?: boolean;
  id: string;
  code: string;
  name: string;
  facts: string;
  promptRequirements?: string | null;
  photo: string;
  photos: string[];
  tasks: ImageTask[];
}
export interface GenerationSettings {
  mode: "live" | "demo";
  baseUrl: string;
  imageModel: string;
  promptModel: string;
  promptProvider: "doubao";
  aspectRatio: string;
  imageSize: string;
  gptSize: string;
  quality: string;
}
export interface Job {
  startedAt?: number;
  finishedAt?: number;
  rateLimitUntil?: number;
  analysisPhase?: "preparing" | "requesting" | "streaming";
  timings?: {
    attemptStartedAt: number;
    requestStartedAt?: number;
    firstTokenAt?: number;
    completedAt?: number;
    imageCount?: number;
    imageBytes?: number;
  };
  createdBy?: { id: string; username: string; displayName: string };
  id: string;
  productId: string;
  productName: string;
  taskId?: string;
  taskIds?: string[];
  role: string;
  status:
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "cancelled"
    | "interrupted";
  kind: string;
  mode: string;
  stage?: string;
  remoteId?: string;
  dependsOn?: string;
  progress?: number;
  promptDrafts?: Record<string, string>;
  receivedChars?: number;
  promptWarnings?: { code: string; role: string; message: string }[];
  validationError?: { code: string; role?: string };
  createdAt: number;
  config?: GenerationSettings;
  error?: string;
  syncError?: string;
}
export interface Workspace {
  syncCursor?: number;
  jobTotal?: number;
  promptTemplates?: Record<string, PromptTemplate>;
  products: Product[];
  jobs: Job[];
  activeProductId?: string;
  settings: GenerationSettings;
  common: string;
  concurrency: number;
  promptConcurrency?: number;
  queryConcurrency?: number;
  paused: boolean;
}
export interface ParsedProduct {
  photos: string[];
  code: string;
  name: string;
  tasks: { references: string[]; prompt: string; result: string }[];
}
export interface ParserContext {
  importId?: string;
  total?: number;
  referenceCount?: number;
  created?: number;
  updated?: number;
  source: {
    name: string;
    columnCount: number;
    cellData?: Record<number, Record<number, { v?: string | number }>>;
  };
  mapping: {
    headerRow: number;
    codeColumn: number;
    nameColumn: number;
    typeColumn: number;
    photoColumn: number;
    photoColumns?: number[];
    roles: number[];
  };
  layout: string;
  candidates: ParsedProduct[];
  changes: ParsedProduct[];
  issues?: string[];
}
export type ColumnField =
  | "codeColumn"
  | "nameColumn"
  | "typeColumn"
  | "photoColumn";
export interface Modal {
  type:
    | "prompt"
    | "product"
    | "common"
    | "version"
    | "media"
    | "settings"
    | "parser"
    | "reconcile"
    | "paste"
    | "prompt-history"
    | "activity";
  key: number;
  productId?: string;
  taskId?: string;
  versionId?: string;
  isNew?: boolean;
  id?: string;
}
export interface UIState {
  productError?: string;
  downloadSelections: Record<string, string[]>;
  view: string;
  search: string;
  productPage: number;
  filter: string;
  modal: Modal | null;
  toast: string;
  saveStatus: string;
  hasKey: boolean;
  hasPromptKey: boolean;
  assistant: { open: boolean; productId?: string; taskId?: string };
  parser: ParserContext | null;
  exporting: boolean;
  importing: boolean;
  sheetConflicts: { key: string; message: string }[];
  sheetPeers: {
    session: string;
    actor: { id: string; displayName: string };
    sheetId: string;
    startRow: number;
    startColumn: number;
  }[];
  sheetStatus: "idle" | "loading" | "ready" | "error";
  formError: string;
  mediaFeedback: string;
  mediaError: boolean;
}
export interface ReadySnapshot {
  ready: true;
  state: Workspace;
  ui: UIState;
  isRemote: boolean;
}
export type ApplicationSnapshot =
  | ReadySnapshot
  | { ready: false; error?: string };
export interface ApplicationController {
  saveProductRequirements(
    productId: string,
    content: string,
    before: string | null,
  ): Promise<void>;
  savePromptTemplate(
    template: PromptTemplate,
    before: PromptTemplate | null,
  ): Promise<void>;
  deletePromptTemplate(template: PromptTemplate): Promise<void>;
  subscribe(listener: () => void): () => void;
  getSnapshot(): ApplicationSnapshot;
  start(): Promise<void>;
  flush(): Promise<void>;
  saveTaskPromptAndGenerate(
    productId: string,
    taskId: string,
    prompt: string,
  ): Promise<void>;
  dispatch(
    action: string,
    data?: Record<string, string | number | undefined>,
  ): Promise<void>;
  submit(event: FormEvent<HTMLFormElement>): Promise<void>;
  changeField(
    event: ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ): Promise<void>;
  uploadFiles(event: ChangeEvent<HTMLInputElement>): void;
  restoreBackup(event: ChangeEvent<HTMLInputElement>): Promise<void>;
  importSheetFile(event: ChangeEvent<HTMLInputElement>): Promise<void>;
  setSearch(value: string): void;
  setProductPage(value: number): void;
  resolveSheetConflict(key: string, prefer: "local" | "remote"): Promise<void>;
  closeModal(): void;
  updateParser(
    field: ColumnField | "layout" | "headerRow" | undefined,
    roleIndex: number | null | undefined,
    value: number | string,
  ): void;
  dispose(): void;
}
export interface ApplicationContextValue extends ReadySnapshot {
  controller: ApplicationController;
  user: CurrentUser;
}
export interface PromptTemplate {
  id: string;
  name: string;
  content: string;
  updatedAt: number;
}
