export type ComfyHealth = {
  online: boolean;
  url: string;
  latencyMs: number | null;
  error: string | null;
  system?: {
    devices?: unknown;
  };
};

export type GenerateKind = "image" | "video";

export type GalleryItem = {
  id: string;
  name: string;
  relativePath: string;
  mime: string;
  kind: "image" | "video" | "other";
  sizeBytes: number;
  mtimeMs: number;
  url: string;
};

export type ModelType = "checkpoint" | "lora" | "vae" | "other";

export type ModelCatalogEntry = {
  id: string;
  name: string;
  type: ModelType;
  filename: string;
  /** Podkatalog względem COMFYUI_MODELS_DIR, np. checkpoints */
  targetSubdir: string;
  downloadUrl: string;
  sizeHint: string;
  notes: string;
  vramHintGb?: number;
};

export type ModelStatus = "ready" | "missing" | "downloading" | "error";

export type ModelLibraryItem = ModelCatalogEntry & {
  status: ModelStatus;
  installedPath: string | null;
  downloadJobId: string | null;
  error: string | null;
};

export type DownloadJob = {
  id: string;
  modelId: string;
  filename: string;
  targetPath: string;
  status: "queued" | "downloading" | "done" | "error";
  bytesReceived: number;
  bytesTotal: number | null;
  percent: number | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
};

export type StudioPublicConfig = {
  comfyUrl: string;
  modelsDirConfigured: boolean;
  outputDirConfigured: boolean;
  modelsDir: string | null;
  outputDir: string | null;
  passwordRequired: boolean;
  defaultCheckpoint: string;
};
