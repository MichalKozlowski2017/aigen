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

/**
 * Limity LTXV length (8n+1).
 * maxLength 121 ≈ 5.0 s @ 24 FPS (wcześniej 65 ≈ 2.7 s — stąd „ustawiłem 5s, dostałem ~2s”).
 * Powyżej comfortLength ostrzeżenie VRAM na 16 GB.
 */
export const LTX_UI_LIMITS = {
  maxWidth: 768,
  maxHeight: 512,
  maxFps: 24,
  minLength: 17,
  /** 8*15+1 — realne 5 s @ 24 FPS */
  maxLength: 121,
  /** ~2.7 s @ 24 — bezpieczniej na 16 GB */
  comfortLength: 65,
  comfortDurationSec: 3,
  comfortFps: 24,
  defaultDurationSec: 2,
  defaultFps: 24,
  defaultWidth: 768,
  defaultHeight: 512,
  /** Górny sufit UI (sekundy); faktyczny max = maxLength/fps */
  maxDurationSec: 5,
  note: "LTX: długość pliku = klatki/FPS (length 8n+1). Max 121 klatek (~5 s @ 24 FPS). Na 16 GB powyżej ~65 klatek ryzyko OOM. VHS frame_rate = Twój FPS.",
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
  note: "SVD: szybki draft. Obraz startowy w Comfy input. Na ~16 GB realistycznie ~25 klatek. Długość ≈ klatki/FPS.",
} as const;

/** Zaokrąglij do 8n+1 (wymóg LTXVImgToVideo.length), w limicie min/max. */
export function snapLtxLength(frames: number): number {
  const clamped = Math.min(
    LTX_UI_LIMITS.maxLength,
    Math.max(LTX_UI_LIMITS.minLength, Math.round(frames))
  );
  const n = Math.round((clamped - 1) / 8);
  const snapped = n * 8 + 1;
  return Math.min(
    LTX_UI_LIMITS.maxLength,
    Math.max(LTX_UI_LIMITS.minLength, snapped)
  );
}

/** Max czas (s) przy danym FPS = maxLength / fps (zaokrąglone w dół do 0.1). */
export function maxLtxDurationAtFps(fps: number): number {
  const f = Math.min(
    Math.max(Math.round(fps) || LTX_UI_LIMITS.defaultFps, 1),
    LTX_UI_LIMITS.maxFps
  );
  return Math.floor((LTX_UI_LIMITS.maxLength / f) * 10) / 10;
}

/** Efektywna długość klipu = frames / fps. */
export function effectiveDurationSec(frames: number, fps: number): number {
  const f = Math.max(1, fps);
  return Math.round((frames / f) * 100) / 100;
}

export function isVideoEngine(value: unknown): value is VideoEngineId {
  return value === "ltx" || value === "svd";
}
