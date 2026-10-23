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
  /** Skąd pochodzi wpis: lokalny OUTPUT_DIR albo historia/output Comfy przez tunel. */
  source?: "local" | "comfy";
  /** Pola Comfy /view — do ponownego użycia (np. start frame w wideo). */
  comfy?: {
    filename: string;
    subfolder: string;
    type: string;
  };
};

export type ModelType =
  | "checkpoint"
  | "unet"
  | "clip"
  | "lora"
  | "vae"
  | "other";

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
  /** local = skan dysku; comfy = GET /models/{folder} przez COMFYUI_URL */
  source?: "local" | "comfy";
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

export type EngineSide = "comfy" | "coder" | "neither" | "both";

export type EngineSwitchTarget = "comfy" | "coder";

/** Widok przełącznika GPU. Sekret sterowania nigdy tu nie trafia. */
export type EngineSwitchView = {
  ok: true;
  available: boolean;
  unavailableReason: string | null;
  side: EngineSide | null;
  comfyOnline: boolean;
  coderOnline: boolean;
  comfyQueueRunning: boolean;
  switching: boolean;
  switchTarget: EngineSwitchTarget | null;
  switchError: string | null;
  unreachable: boolean;
};

export type StudioPublicConfig = {
  comfyUrl: string;
  /** true gdy COMFYUI_URL nie wskazuje na localhost (Vercel + tunel). */
  comfyRemote: boolean;
  modelsDirConfigured: boolean;
  outputDirConfigured: boolean;
  modelsDir: string | null;
  outputDir: string | null;
  passwordRequired: boolean;
  defaultCheckpoint: string;
  /** Domyślny model w UI Obraz (`flux` albo nazwa checkpointu). */
  defaultImageModel: string;
};
