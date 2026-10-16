/** Silniki wideo Studio + limity pod ~16 GB VRAM (RTX 5080). */

export type VideoEngineId = "ltx" | "svd";

export const DEFAULT_VIDEO_ENGINE: VideoEngineId = "ltx";

export const DEFAULT_LTX_CHECKPOINT = "ltx-video-2b-v0.9.5.safetensors";
/** Alternatywa jeśli 0.9.5 jeszcze nie ma na dysku */
export const FALLBACK_LTX_CHECKPOINT = "ltx-video-2b-v0.9.safetensors";
export const DEFAULT_LTX_CLIP = "t5xxl_fp8_e4m3fn_scaled.safetensors";
export const FALLBACK_LTX_CLIP_FP16 = "t5xxl_fp16.safetensors";
export const DEFAULT_CODEFORMER = "codeformer.pth";

export const VIDEO_ENGINE_OPTIONS: Array<{
  id: VideoEngineId;
  label: string;
  blurb: string;
}> = [
  {
    id: "ltx",
    label: "LTX (jakość)",
    blurb: "LTXV 2B I2V — domyślna ścieżka jakości. Krótsze klipy, lepszy ruch.",
  },
  {
    id: "svd",
    label: "SVD (draft)",
    blurb: "Szybki draft SVD XT — gdy LTX niedostępne albo potrzebujesz szybkiego podglądu.",
  },
];

/** Limity UI / VRAM per silnik */
export const LTX_UI_LIMITS = {
  maxDurationSec: 5,
  maxWidth: 768,
  maxHeight: 512,
  maxFps: 24,
  /** LTXV length: 8n+1 */
  minLength: 17,
  maxLength: 65,
  comfortLength: 49,
  comfortDurationSec: 3,
  comfortFps: 24,
  defaultDurationSec: 2,
  defaultFps: 24,
  defaultWidth: 768,
  defaultHeight: 512,
  note: "LTX: krótkie klipy jakościowe (~2–3 s @ 24 FPS, length 8n+1). Wymaga checkpointu LTXV + T5 (CLIPLoader type=ltxv) + VHS. Face restore: facerestore_cf + codeformer.pth.",
} as const;

export const SVD_UI_LIMITS = {
  maxDurationSec: 60,
  maxWidth: 576,
  maxHeight: 576,
  maxFps: 30,
  schemaMaxFrames: 4096,
  minFrames: 1,
  comfortDurationSec: 4,
  comfortFps: 12,
  comfortFrames: 25,
  defaultDurationSec: 2,
  defaultFps: 6,
  defaultWidth: 512,
  defaultHeight: 512,
  note: "SVD: szybki draft. Obraz startowy w Comfy input. Na ~16 GB realistycznie ~25 klatek.",
} as const;

/** Zaokrąglij do 8n+1 (wymóg LTXVImgToVideo.length). */
export function snapLtxLength(frames: number): number {
  const clamped = Math.min(
    LTX_UI_LIMITS.maxLength,
    Math.max(LTX_UI_LIMITS.minLength, Math.round(frames))
  );
  // Najbliższe 8n+1
  const n = Math.round((clamped - 1) / 8);
  return Math.min(
    LTX_UI_LIMITS.maxLength,
    Math.max(LTX_UI_LIMITS.minLength, n * 8 + 1)
  );
}

export function isVideoEngine(value: unknown): value is VideoEngineId {
  return value === "ltx" || value === "svd";
}
