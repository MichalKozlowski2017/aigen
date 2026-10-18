import {
  peekComfyUrl,
  resolveComfyUrl,
} from "./comfy-url-store";
import { FLUX_MODEL_ID } from "./flux";
import type { StudioPublicConfig } from "./types";

const DEFAULT_COMFY_URL = "http://127.0.0.1:8188";
/** Checkpoint SDXL — opcja w dropdownie Obraz (nie domyślny silnik). */
const DEFAULT_CHECKPOINT = "sd_xl_base_1.0.safetensors";

function trimOrUndefined(value: string | undefined): string | undefined {
  const t = value?.trim();
  return t ? t : undefined;
}

/**
 * Sync COMFYUI_URL — pamięć (override z Legion publish) albo env.
 * Preferuj `await getComfyUrlAsync()` w async ścieżkach (hydrate z KV).
 */
export function getComfyUrl(): string {
  return peekComfyUrl(DEFAULT_COMFY_URL);
}

/** Async: pamięć → Vercel KV (opcjonalnie) → env → default. */
export async function getComfyUrlAsync(): Promise<string> {
  return resolveComfyUrl(DEFAULT_COMFY_URL);
}

/** true gdy COMFYUI_URL to tunel / zdalny host (nie localhost / 127.0.0.1). */
export function isRemoteComfyUrl(url: string = getComfyUrl()): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host !== "localhost" && host !== "127.0.0.1" && host !== "::1";
  } catch {
    return !/localhost|127\.0\.0\.1/i.test(url);
  }
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

/**
 * true = eksperymentalny tryb „Legion worker SoT” (panel GET bez advance).
 * **Domyślnie wyłączone** — nie ustawiaj `PIPELINE_LEGION_WORKER=1` w produkcji
 * bez świadomego protokołu (register nie ma osobnego auth poza STUDIO_PASSWORD).
 * Niezależny skrypt `aigen-queue-worker.py` na Legionie (jeśli jest) to osobna
 * ścieżka — nie wymaga tej flagi.
 */
export function isPipelineLegionWorker(): boolean {
  const v = trimOrUndefined(process.env.PIPELINE_LEGION_WORKER)?.toLowerCase();
  return v === "1" || v === "true" || v === "yes";
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

function buildPublicConfig(comfyUrl: string): StudioPublicConfig {
  const modelsDir = getModelsDir();
  const outputDir = getOutputDir();
  return {
    comfyUrl,
    comfyRemote: isRemoteComfyUrl(comfyUrl),
    modelsDirConfigured: Boolean(modelsDir),
    outputDirConfigured: Boolean(outputDir),
    modelsDir,
    outputDir,
    passwordRequired: Boolean(getStudioPassword()),
    defaultCheckpoint: getDefaultCheckpoint(),
    defaultImageModel: getDefaultImageModel(),
  };
}

/** Sync config (może być stale vs KV). Preferuj getStudioPublicConfigAsync. */
export function getStudioPublicConfig(): StudioPublicConfig {
  return buildPublicConfig(getComfyUrl());
}

export async function getStudioPublicConfigAsync(): Promise<StudioPublicConfig> {
  return buildPublicConfig(await getComfyUrlAsync());
}
