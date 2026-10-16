/** Silniki wideo Studio + limity pod ~16 GB VRAM (RTX 5080) + 64 GB RAM offload. */

export type VideoEngineId = "wan" | "ltx" | "svd";

export const DEFAULT_VIDEO_ENGINE: VideoEngineId = "wan";

/** Wan 2.1 I2V 480p FP8 — Comfy-Org (16 GB + Dynamic VRAM / offload). */
export const DEFAULT_WAN_UNET = "wan2.1_i2v_480p_14B_fp8_e4m3fn.safetensors";
export const FALLBACK_WAN_UNET_FP16 = "wan2.1_i2v_480p_14B_fp16.safetensors";
export const DEFAULT_WAN_CLIP = "umt5_xxl_fp8_e4m3fn_scaled.safetensors";
export const DEFAULT_WAN_VAE = "wan_2.1_vae.safetensors";
export const DEFAULT_WAN_CLIP_VISION = "clip_vision_h.safetensors";

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
    id: "wan",
    label: "Wan (jakość)",
    blurb:
      "Fotoreal · wolniej · offload (FP8 + Dynamic VRAM). Chunki + stitch jak LTX.",
  },
  {
    id: "ltx",
    label: "LTX (draft)",
    blurb:
      "Szybszy draft LTXV 2B. Do 121 klatek/chunk; dłuższe = auto chunki + stitch.",
  },
  {
    id: "svd",
    label: "SVD (legacy)",
    blurb: "Krótki legacy draft — bez chunków.",
  },
];

/**
 * Wan 2.1 I2V — length 4n+1 (WanImageToVideo step 4).
 * SAFE maxLength=81 @ 832×480 FP8 — provisional do potwierdzenia Legionem.
 * Dłuższe: planWanChunks (overlap 1 + ffmpeg stitch).
 */
export const WAN_UI_LIMITS = {
  maxWidth: 832,
  maxHeight: 480,
  maxFps: 16,
  minLength: 17,
  /** Max klatek na jeden prompt Wan (provisional SAFE @ 480p FP8 + offload) */
  maxLength: 81,
  comfortLength: 33,
  comfortDurationSec: 2,
  comfortFps: 16,
  defaultDurationSec: 2,
  defaultFps: 16,
  defaultWidth: 832,
  defaultHeight: 480,
  maxDurationSec: 60,
  note: "Wan: fotoreal / wolniej / offload (FP8 + Dynamic VRAM na 16 GB). 1 chunk ≤81 klatek (4n+1 @ 16 FPS). Powyżej — auto chunki (overlap 1) + stitch. SAFE do potwierdzenia Legionem.",
} as const;

/**
 * Limity LTXV length (8n+1). Legion SAFE maxLength=121 @ 768×512.
 * Draft / szybszy wariant względem Wan.
 */
export const LTX_UI_LIMITS = {
  maxWidth: 768,
  maxHeight: 512,
  maxFps: 24,
  minLength: 17,
  maxLength: 121,
  comfortLength: 65,
  comfortDurationSec: 3,
  comfortFps: 24,
  defaultDurationSec: 2,
  defaultFps: 24,
  defaultWidth: 768,
  defaultHeight: 512,
  maxDurationSec: 60,
  note: "LTX (draft): 1 chunk ≤121 klatek (8n+1). Powyżej — auto chunki (overlap 1) + stitch. Szybszy niż Wan, słabszy fotoreal.",
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
  note: "SVD: legacy krótki draft (bez chunków). Obraz startowy w Comfy input.",
} as const;

/** Zaokrąglij do 4n+1 (WanImageToVideo). */
export function snapWanLength(
  frames: number,
  maxPerChunk = WAN_UI_LIMITS.maxLength
): number {
  const clamped = Math.min(
    maxPerChunk,
    Math.max(WAN_UI_LIMITS.minLength, Math.round(frames))
  );
  const n = Math.round((clamped - 1) / 4);
  const snapped = n * 4 + 1;
  return Math.min(
    maxPerChunk,
    Math.max(WAN_UI_LIMITS.minLength, snapped)
  );
}

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

export function maxWanDurationAtFps(fps: number): number {
  const f = Math.min(
    Math.max(Math.round(fps) || WAN_UI_LIMITS.defaultFps, 1),
    WAN_UI_LIMITS.maxFps
  );
  return Math.floor((WAN_UI_LIMITS.maxLength / f) * 10) / 10;
}

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
  return value === "wan" || value === "ltx" || value === "svd";
}

export function isChunkedVideoEngine(
  value: VideoEngineId
): value is "wan" | "ltx" {
  return value === "wan" || value === "ltx";
}
