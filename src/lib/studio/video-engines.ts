/** Silniki wideo Studio + limity pod ~16 GB VRAM (RTX 5080) + 64 GB RAM offload. */

/**
 * Modele z enum `model` na POST /v2/video_generation
 * (OpenAPI platform.minimax.io, video generation v2).
 * Hailuo jest na POST /v1/video_generation — ten enum go nie przyjmuje.
 * Regeneracja (POST /v2/video_regeneration) nie jest modelem generacji.
 */
export type MinimaxModelId =
  | "MiniMax-H3"
  | "MiniMax-H3-Highspeed"
  | "MiniMax-H3-Lite"
  | "MiniMax-H3-Max";

export type MinimaxResolution = "480P" | "768P" | "2K";

/** Jedna opcja UI = model + rozdzielczość wyjścia. `h3-lite` zostaje Lite 768P. */
export type MinimaxVideoEngineId =
  | "h3-768p"
  | "h3-2k"
  | "h3-highspeed"
  | "h3-lite"
  | "h3-lite-480p"
  | "h3-max"
  | "h3-max-480p";

export type VideoEngineId = "wan" | "ltx" | "svd" | MinimaxVideoEngineId;

export const DEFAULT_VIDEO_ENGINE: VideoEngineId = "wan";

/** Wan 2.1 I2V 480p FP8 — Comfy-Org (16 GB + Dynamic VRAM / offload). */
export const DEFAULT_WAN_UNET = "wan2.1_i2v_480p_14B_fp8_e4m3fn.safetensors";
export const FALLBACK_WAN_UNET_FP16 = "wan2.1_i2v_480p_14B_fp16.safetensors";
/** Wan 2.1 I2V 720p FP8 — Legion filename (Comfy-Org scaled). */
export const DEFAULT_WAN_UNET_720P =
  "wan2.1_i2v_720p_14B_fp8_scaled.safetensors";
export const DEFAULT_WAN_CLIP = "umt5_xxl_fp8_e4m3fn_scaled.safetensors";
export const DEFAULT_WAN_VAE = "wan_2.1_vae.safetensors";
export const DEFAULT_WAN_CLIP_VISION = "clip_vision_h.safetensors";

/** Dozwolone FPS Wan w UI (native 16 | 24; Smooth = gen 16 + RIFE). */
export const WAN_FPS_OPTIONS = [16, 24] as const;
export type WanFpsOption = (typeof WAN_FPS_OPTIONS)[number];

export const DEFAULT_LTX_CHECKPOINT = "ltx-video-2b-v0.9.5.safetensors";
export const FALLBACK_LTX_CHECKPOINT = "ltx-video-2b-v0.9.safetensors";
export const DEFAULT_LTX_CLIP = "t5xxl_fp8_e4m3fn_scaled.safetensors";
export const FALLBACK_LTX_CLIP_FP16 = "t5xxl_fp16.safetensors";
export const DEFAULT_CODEFORMER = "codeformer.pth";

const LOCAL_VIDEO_ENGINE_OPTIONS: Array<{
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
 * Chunk lengths (4n+1) — RTX 5080 16GB / Legion A/B:
 * - Fast 480p + LoRA + Sage KJ: **prefer 81** (mniej reloadów / mniej driftu)
 * - Quality 720p: **prefer 65** (SAFE720 L81 interrupted → provisional 65)
 * - Smoke: 33 (krótki test; UI default duration 2s @16fps ≈33 i tak)
 * Mid 49 zostaje opcją UI gdy 81 za ciężkie z LoRA+Sage.
 */
export const WAN_CHUNK_SMOKE = 33;
export const WAN_CHUNK_MID = 49;
export const WAN_CHUNK_QUALITY_720 = 65;
/** Preferowany default Fast / pipeline — równy SAFE maxLength. */
export const WAN_CHUNK_PREFERRED_FAST = 81;
export const WAN_CHUNK_LENGTH_OPTIONS = [
  WAN_CHUNK_SMOKE,
  WAN_CHUNK_MID,
  WAN_CHUNK_QUALITY_720,
  WAN_CHUNK_PREFERRED_FAST,
] as const;
export type WanChunkLengthOption = (typeof WAN_CHUNK_LENGTH_OPTIONS)[number];

/**
 * Wan 2.1 I2V — length 4n+1 (WanImageToVideo step 4).
 * SAFE maxLength=81 (480p FP8) — dłuższe: planWanChunks.
 * FPS 16 | 24; @24fps/10s ≈ 3 chunki (requestedFrames = duration×fps).
 */
export const WAN_UI_LIMITS = {
  maxWidth: 1280,
  maxHeight: 720,
  maxFps: 24,
  minLength: 17,
  /** Max klatek na jeden prompt Wan (SAFE 4n+1 @ FP8 480p + offload) */
  maxLength: WAN_CHUNK_PREFERRED_FAST,
  /**
   * Fast 480p: 81 jest preferowane (nie „risky”).
   * Ostrzeżenie VRAM dla Quality 720p → comfortLength720.
   */
  comfortLength: WAN_CHUNK_PREFERRED_FAST,
  /** Quality 720p — Legion A/B: L81 interrupted → comfort 65 */
  comfortLength720: WAN_CHUNK_QUALITY_720,
  comfortDurationSec: 2,
  comfortFps: 16,
  defaultDurationSec: 2,
  defaultFps: 16,
  defaultWidth: 832,
  defaultHeight: 480,
  qualityWidth: 1280,
  qualityHeight: 720,
  maxDurationSec: 60,
  note: "Wan: Fast 480p chunki preferuj 81 (4n+1). Quality 720p ≤65. Zalecane: Fast + RealESRGAN×2 + RIFE zamiast native 720p (wolne).",
} as const;

/** Preferowany maxPerChunk: Fast 480p → 81, Quality 720p → 65. */
export function preferredWanChunkLength(options: {
  width?: number;
  height?: number;
  model?: string;
  override?: number;
}): number {
  if (
    typeof options.override === "number" &&
    Number.isFinite(options.override)
  ) {
    return snapWanLength(options.override);
  }
  const w = options.width ?? WAN_UI_LIMITS.defaultWidth;
  const h = options.height ?? WAN_UI_LIMITS.defaultHeight;
  const m = (options.model ?? "").toLowerCase();
  const is720 =
    w >= 1024 ||
    h >= 640 ||
    m.includes("720p") ||
    m.includes("720_");
  return is720 ? WAN_CHUNK_QUALITY_720 : WAN_CHUNK_PREFERRED_FAST;
}

/** Wybierz UNET 480p vs 720p po nazwie / rozdzielczości. */
export function resolveWanUnet(options: {
  model?: string;
  width?: number;
  height?: number;
}): string {
  const m = options.model?.trim();
  if (m && m.toLowerCase().includes("wan")) return m;
  const w = options.width ?? WAN_UI_LIMITS.defaultWidth;
  const h = options.height ?? WAN_UI_LIMITS.defaultHeight;
  const shortSide = Math.min(w, h);
  const longSide = Math.max(w, h);
  // Fast 480p portrait 480×832 nie jest 720p — short≥640 lub long≥1024
  if (shortSide >= 640 || longSide >= 1024) return DEFAULT_WAN_UNET_720P;
  return DEFAULT_WAN_UNET;
}

export function snapWanFps(fps: number): WanFpsOption {
  const n = Math.round(fps);
  if (n >= 20) return 24;
  return 16;
}

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

/**
 * MiniMax image-to-video na POST /v2/video_generation (pay-as-you-go).
 * Identyfikatory i pary rozdzielczości: OpenAPI v2 (26 Oct 2026).
 * USD/s: kolumna „Output Video per second” z platform.minimax.io/docs/pricing/overview
 * (ten sam dzień). Jeden obraz startowy mieści się w darmowym limicie zdjęć.
 * Klucz: MINIMAX_API_KEY — pay-as-you-go, nie subskrypcja i nie pakiet Hailuo.
 * Hailuo (POST /v1/video_generation) i regeneracja (/v2/video_regeneration) nie wchodzą.
 */
export const MINIMAX_API_KEY_ENV = "MINIMAX_API_KEY";

export type MinimaxEngineSpec = {
  id: MinimaxVideoEngineId;
  choiceLabel: string;
  model: MinimaxModelId;
  resolution: MinimaxResolution;
  usdPerSec: number;
  minDurationSec: number;
  maxDurationSec: number;
  defaultDurationSec: number;
  defaultFps: 24;
};

export const MINIMAX_VIDEO_ENGINES: readonly MinimaxEngineSpec[] = [
  {
    id: "h3-768p",
    choiceLabel: "H3 768P",
    model: "MiniMax-H3",
    resolution: "768P",
    usdPerSec: 0.08,
    minDurationSec: 4,
    maxDurationSec: 15,
    defaultDurationSec: 5,
    defaultFps: 24,
  },
  {
    id: "h3-2k",
    choiceLabel: "H3 2K",
    model: "MiniMax-H3",
    resolution: "2K",
    usdPerSec: 0.13,
    minDurationSec: 4,
    maxDurationSec: 15,
    defaultDurationSec: 5,
    defaultFps: 24,
  },
  {
    id: "h3-highspeed",
    choiceLabel: "H3-Highspeed 768P",
    model: "MiniMax-H3-Highspeed",
    resolution: "768P",
    usdPerSec: 0.06,
    minDurationSec: 4,
    maxDurationSec: 15,
    defaultDurationSec: 5,
    defaultFps: 24,
  },
  {
    id: "h3-lite",
    choiceLabel: "H3-Lite 768P",
    model: "MiniMax-H3-Lite",
    resolution: "768P",
    usdPerSec: 0.04,
    minDurationSec: 4,
    maxDurationSec: 15,
    defaultDurationSec: 5,
    defaultFps: 24,
  },
  {
    id: "h3-lite-480p",
    choiceLabel: "H3-Lite 480P",
    model: "MiniMax-H3-Lite",
    resolution: "480P",
    usdPerSec: 0.025,
    minDurationSec: 4,
    maxDurationSec: 15,
    defaultDurationSec: 5,
    defaultFps: 24,
  },
  {
    id: "h3-max",
    choiceLabel: "H3-Max 768P",
    model: "MiniMax-H3-Max",
    resolution: "768P",
    usdPerSec: 0.08,
    minDurationSec: 5,
    maxDurationSec: 15,
    defaultDurationSec: 5,
    defaultFps: 24,
  },
  {
    id: "h3-max-480p",
    choiceLabel: "H3-Max 480P",
    model: "MiniMax-H3-Max",
    resolution: "480P",
    usdPerSec: 0.05,
    minDurationSec: 5,
    maxDurationSec: 15,
    defaultDurationSec: 5,
    defaultFps: 24,
  },
];

const MINIMAX_BY_ID = new Map<MinimaxVideoEngineId, MinimaxEngineSpec>(
  MINIMAX_VIDEO_ENGINES.map((spec) => [spec.id, spec])
);

export const VIDEO_ENGINE_IDS = [
  "wan",
  "ltx",
  "svd",
  ...MINIMAX_VIDEO_ENGINES.map((spec) => spec.id),
] as const satisfies readonly VideoEngineId[];

/** Cena wyjścia przy przycisku: 0,04 albo 0,025. */
export function formatUsdPerSec(usdPerSec: number): string {
  const digits = usdPerSec < 0.03 ? 3 : 2;
  return usdPerSec.toFixed(digits).replace(".", ",");
}

export const VIDEO_ENGINE_OPTIONS: Array<{
  id: VideoEngineId;
  label: string;
  blurb: string;
}> = [
  ...LOCAL_VIDEO_ENGINE_OPTIONS,
  ...MINIMAX_VIDEO_ENGINES.map((spec) => ({
    id: spec.id,
    label: `${spec.choiceLabel} · ${formatUsdPerSec(spec.usdPerSec)} USD/s`,
    blurb: `${spec.model} · ${spec.minDurationSec}–${spec.maxDurationSec} s · pay-as-you-go · bez Comfy`,
  })),
];

export function isMinimaxVideoEngine(
  value: unknown
): value is MinimaxVideoEngineId {
  return typeof value === "string" && MINIMAX_BY_ID.has(value as MinimaxVideoEngineId);
}

export function getMinimaxEngine(id: MinimaxVideoEngineId): MinimaxEngineSpec {
  const spec = MINIMAX_BY_ID.get(id);
  if (!spec) {
    throw new Error(`Nieznany silnik MiniMax: ${id}`);
  }
  return spec;
}

function minimaxDisplaySide(resolution: MinimaxResolution): number {
  if (resolution === "2K") return 1440;
  if (resolution === "480P") return 480;
  return 768;
}

export function minimaxUiLimits(id: MinimaxVideoEngineId) {
  const spec = getMinimaxEngine(id);
  const side = minimaxDisplaySide(spec.resolution);
  return {
    minDurationSec: spec.minDurationSec,
    maxDurationSec: spec.maxDurationSec,
    defaultDurationSec: spec.defaultDurationSec,
    defaultFps: spec.defaultFps,
    maxFps: spec.defaultFps,
    defaultWidth: side,
    defaultHeight: side,
    maxWidth: side,
    maxHeight: side,
    note: `${spec.model} ${spec.resolution}, pay-as-you-go (~${formatUsdPerSec(spec.usdPerSec)} USD/s). Czas ${spec.minDurationSec}–${spec.maxDurationSec} s, domyślnie ${spec.defaultDurationSec} s. Obraz startowy to pierwsza klatka (kadr z obrazu). Comfy nie jest wymagane. Klucz MINIMAX_API_KEY (pay-as-you-go, nie pakiet Hailuo).`,
  };
}

/** Lite 768P — dotychczasowy silnik, jedna z opcji katalogu. */
export const MINIMAX_H3_LITE_MODEL = "MiniMax-H3-Lite" as const;
export const H3_LITE_RESOLUTION = "768P" as const;
export const H3_LITE_USD_PER_SEC = 0.04;

export const H3_LITE_UI_LIMITS = {
  ...minimaxUiLimits("h3-lite"),
  note: "MiniMax-H3-Lite 768P, pay-as-you-go (~0,04 USD/s). Czas 4–15 s, domyślnie 5 s (~0,20 USD). Obraz startowy to pierwsza klatka. Comfy nie jest wymagane. Klucz MINIMAX_API_KEY (pay-as-you-go, nie pakiet Hailuo).",
} as const;

/** Czas wybranego silnika MiniMax: liczba całkowita w zakresie tego modelu. */
export function clampMinimaxDuration(
  id: MinimaxVideoEngineId,
  value: number | undefined | null
): number {
  const spec = getMinimaxEngine(id);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return spec.defaultDurationSec;
  }
  const rounded = Math.round(value);
  if (rounded < spec.minDurationSec) return spec.minDurationSec;
  if (rounded > spec.maxDurationSec) return spec.maxDurationSec;
  return rounded;
}

export function minimaxEstimatedUsd(
  id: MinimaxVideoEngineId,
  durationSec: number
): number {
  const spec = getMinimaxEngine(id);
  const seconds = clampMinimaxDuration(id, durationSec);
  return Math.round(seconds * spec.usdPerSec * 100) / 100;
}

/** Czas H3-Lite 768P: liczba całkowita w zakresie API. Brak wartości → 5 s. */
export function clampH3LiteDuration(value: number | undefined | null): number {
  return clampMinimaxDuration("h3-lite", value);
}

export function h3LiteEstimatedUsd(durationSec: number): number {
  return minimaxEstimatedUsd("h3-lite", durationSec);
}

/** Silnik chmurowy nie czeka na bramkę zdrowia ComfyUI. */
export function videoEngineSkipsComfyHealth(
  engine: string | undefined
): boolean {
  return isMinimaxVideoEngine(engine);
}

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
  return (
    value === "wan" ||
    value === "ltx" ||
    value === "svd" ||
    isMinimaxVideoEngine(value)
  );
}

export function isChunkedVideoEngine(
  value: VideoEngineId
): value is "wan" | "ltx" {
  return value === "wan" || value === "ltx";
}
