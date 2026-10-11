import type { ChangeEvent, FormEvent } from "react";

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
  id: string;
  code: string;
  name: string;
  facts: string;
  photo: string;
  photos: string[];
  tasks: ImageTask[];
}
export interface GenerationSettings {
  mode: "live" | "demo";
  baseUrl: string;
  imageModel: string;
  promptModel: string;
  aspectRatio: string;
  imageSize: string;
  gptSize: string;
  quality: string;
}
export interface Job {
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
  progress?: number;
  promptDrafts?: Record<string, string>;
  receivedChars?: number;
  createdAt: number;
  config?: GenerationSettings;
  error?: string;
  syncError?: string;
}
export interface Workspace {
  products: Product[];
  jobs: Job[];
  activeProductId?: string;
  settings: GenerationSettings;
  common: string;
  concurrency: number;
  paused: boolean;
}
export interface ParsedProduct {
  code: string;
  name: string;
  tasks: { references: string[]; prompt: string; result: string }[];
}
export interface ParserContext {
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
    roles: number[];
  };
  layout: string;
  candidates: ParsedProduct[];
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
    | "key"
    | "parser"
    | "reconcile"
    | "paste"
    | "prompt-history";
  key: number;
  productId?: string;
  taskId?: string;
  versionId?: string;
  isNew?: boolean;
  id?: string;
}
export interface UIState {
  view: string;
  search: string;
  filter: string;
  modal: Modal | null;
  toast: string;
  saveStatus: string;
  hasKey: boolean;
  parser: ParserContext | null;
  exporting: boolean;
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
  subscribe(listener: () => void): () => void;
  getSnapshot(): ApplicationSnapshot;
  start(): Promise<void>;
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
  setSearch(value: string): void;
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
}
