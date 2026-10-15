import { FLUX_MODEL_ID } from "./flux";
import type { StudioPublicConfig } from "./types";

const DEFAULT_COMFY_URL = "http://127.0.0.1:8188";
/** Checkpoint SDXL — opcja w dropdownie Obraz (nie domyślny silnik). */
const DEFAULT_CHECKPOINT = "sd_xl_base_1.0.safetensors";

function trimOrUndefined(value: string | undefined): string | undefined {
  const t = value?.trim();
  return t ? t : undefined;
}

export function getComfyUrl(): string {
  return trimOrUndefined(process.env.COMFYUI_URL) ?? DEFAULT_COMFY_URL;
}

export function getModelsDir(): string | null {
  return trimOrUndefined(process.env.COMFYUI_MODELS_DIR) ?? null;
}

export function getOutputDir(): string | null {
  return trimOrUndefined(process.env.COMFYUI_OUTPUT_DIR) ?? null;
}

export function getStudioPassword(): string | null {
  return trimOrUndefined(process.env.STUDIO_PASSWORD) ?? null;
}

export function getDefaultCheckpoint(): string {
  return (
    trimOrUndefined(process.env.STUDIO_DEFAULT_CHECKPOINT) ?? DEFAULT_CHECKPOINT
  );
}

/** Domyślny wybór w UI Obraz — Flux (jakość > czas). OVERRIDE: STUDIO_DEFAULT_IMAGE_MODEL=sdxl|flux|<plik> */
export function getDefaultImageModel(): string {
  const raw = trimOrUndefined(process.env.STUDIO_DEFAULT_IMAGE_MODEL);
  if (!raw || raw === "flux") return FLUX_MODEL_ID;
  if (raw === "sdxl") return getDefaultCheckpoint();
  return raw;
}

export function getStudioPublicConfig(): StudioPublicConfig {
  const modelsDir = getModelsDir();
  const outputDir = getOutputDir();
  return {
    comfyUrl: getComfyUrl(),
    modelsDirConfigured: Boolean(modelsDir),
    outputDirConfigured: Boolean(outputDir),
    modelsDir,
    outputDir,
    passwordRequired: Boolean(getStudioPassword()),
    defaultCheckpoint: getDefaultCheckpoint(),
    defaultImageModel: getDefaultImageModel(),
  };
}
