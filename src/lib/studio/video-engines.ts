/** Silniki wideo Studio + limity pod ~16 GB VRAM (RTX 5080). */

export type VideoEngineId = "ltx" | "svd";

export const DEFAULT_VIDEO_ENGINE: VideoEngineId = "ltx";

export const DEFAULT_LTX_CHECKPOINT = "ltx-video-2b-v0.9.5.safetensors";
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
    blurb:
      "LTXV 2B I2V. Do 121 klatek/chunk; dłuższe klipy = automatyczne chunki + stitch (jak Legion).",
  },
  {
    id: "svd",
    label: "SVD (draft)",
    blurb: "Szybki krótki draft — bez chunków.",
  },
];

/**
 * Limity LTXV length (8n+1). Legion SAFE maxLength=121 @ 768×512.
 * Dłuższe wideo: planLtxChunks (overlap 1 + ffmpeg stitch).
 */
export const LTX_UI_LIMITS = {
  maxWidth: 768,
  maxHeight: 512,
  maxFps: 24,
  minLength: 17,
  /** Max klatek na jeden prompt LTX (SAFE) */
  maxLength: 121,
  comfortLength: 65,
  comfortDurationSec: 3,
  comfortFps: 24,
  defaultDurationSec: 2,
  defaultFps: 24,
  defaultWidth: 768,
  defaultHeight: 512,
  /** UI: długie wideo przez chunki */
  maxDurationSec: 60,
  note: "LTX: 1 chunk ≤121 klatek (8n+1). Powyżej — auto chunki (overlap 1) + stitch. Długość = unikalne_klatki/FPS. VHS frame_rate = Twój FPS.",
} as const;

export const SVD_UI_LIMITS = {
  maxDurationSec: 8,
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
  note: "SVD: tylko krótki draft (bez chunków). Obraz startowy w Comfy input.",
} as const;

/** Zaokrąglij do 8n+1 w limicie min…maxPerChunk. */
export function snapLtxLength(
  frames: number,
  maxPerChunk = LTX_UI_LIMITS.maxLength
): number {
  const clamped = Math.min(
    maxPerChunk,
    Math.max(LTX_UI_LIMITS.minLength, Math.round(frames))
  );
  const n = Math.round((clamped - 1) / 8);
  const snapped = n * 8 + 1;
  return Math.min(
    maxPerChunk,
    Math.max(LTX_UI_LIMITS.minLength, snapped)
  );
}

/** Max czas jednego chunka przy FPS. */
export function maxLtxDurationAtFps(fps: number): number {
  const f = Math.min(
    Math.max(Math.round(fps) || LTX_UI_LIMITS.defaultFps, 1),
    LTX_UI_LIMITS.maxFps
  );
  return Math.floor((LTX_UI_LIMITS.maxLength / f) * 10) / 10;
}

export function effectiveDurationSec(frames: number, fps: number): number {
  const f = Math.max(1, fps);
  return Math.round((frames / f) * 100) / 100;
}

export function isVideoEngine(value: unknown): value is VideoEngineId {
  return value === "ltx" || value === "svd";
}
