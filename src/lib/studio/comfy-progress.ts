/**
 * Mapa etapów Comfy → % i polskie etykiety.
 * Bez kłamliwego stałego 25% — albo realny step i/N, albo indeterminate + etap.
 */

export type ProgressStage =
  | "queued"
  | "loading"
  | "prep"
  | "sampling"
  | "vae"
  | "saving"
  | "stitch"
  | "rife"
  | "upscale"
  | "done"
  | "fail"
  | "running"
  | "unknown";

/** Wagi etapów w obrębie pojedynczego joba Comfy (0–100). */
const STAGE_RANGE: Record<
  ProgressStage,
  { lo: number; hi: number; indeterminate?: boolean }
> = {
  queued: { lo: 2, hi: 8 },
  loading: { lo: 8, hi: 18, indeterminate: true },
  prep: { lo: 18, hi: 28, indeterminate: true },
  sampling: { lo: 28, hi: 84 },
  vae: { lo: 84, hi: 92, indeterminate: true },
  saving: { lo: 92, hi: 98, indeterminate: true },
  stitch: { lo: 92, hi: 96, indeterminate: true },
  rife: { lo: 96, hi: 99, indeterminate: true },
  upscale: { lo: 96, hi: 99, indeterminate: true },
  running: { lo: 10, hi: 20, indeterminate: true },
  done: { lo: 100, hi: 100 },
  fail: { lo: 100, hi: 100 },
  unknown: { lo: 0, hi: 0, indeterminate: true },
};

const LOADER_TYPES = new Set([
  "UNETLoader",
  "CLIPLoader",
  "VAELoader",
  "CLIPVisionLoader",
  "CheckpointLoaderSimple",
  "ImageOnlyCheckpointLoader",
  "DualCLIPLoader",
  "LoraLoader",
  "ControlNetLoader",
]);

const PREP_TYPES = new Set([
  "LoadImage",
  "CLIPTextEncode",
  "CLIPVisionEncode",
  "FluxGuidance",
  "BasicGuider",
  "Flux2Scheduler",
  "EmptyFlux2LatentImage",
  "EmptyLatentImage",
  "RandomNoise",
  "KSamplerSelect",
  "WanImageToVideo",
  "LTXVImgToVideo",
  "LTXVConditioning",
  "LTXVScheduler",
  "SVD_img2vid_Conditioning",
  "ModelSamplingSD3",
]);

const SAMPLER_TYPES = new Set([
  "KSampler",
  "KSamplerAdvanced",
  "SamplerCustom",
  "SamplerCustomAdvanced",
]);

const VAE_TYPES = new Set(["VAEDecode", "VAEDecodeTiled", "VAEEncode"]);

const SAVE_TYPES = new Set([
  "SaveImage",
  "VHS_VideoCombine",
  "SaveVideo",
  "VHS_VideoCombinePath",
]);

export function classifyNodeType(
  classType: string | null | undefined
): ProgressStage {
  if (!classType) return "running";
  if (LOADER_TYPES.has(classType)) return "loading";
  if (PREP_TYPES.has(classType)) return "prep";
  if (SAMPLER_TYPES.has(classType)) return "sampling";
  if (VAE_TYPES.has(classType)) return "vae";
  if (SAVE_TYPES.has(classType)) return "saving";
  if (/rife|frame.?interpol/i.test(classType)) return "rife";
  if (/upscale|esrgan|ultimate/i.test(classType)) return "upscale";
  return "running";
}

export function polishNodeLabel(classType: string | null | undefined): string {
  if (!classType) return "ComfyUI";
  const map: Record<string, string> = {
    UNETLoader: "ładowanie UNET",
    CLIPLoader: "ładowanie CLIP",
    VAELoader: "ładowanie VAE",
    CLIPVisionLoader: "ładowanie CLIP Vision",
    CheckpointLoaderSimple: "ładowanie checkpointu",
    DualCLIPLoader: "ładowanie CLIP",
    LoadImage: "wczytywanie obrazu",
    CLIPTextEncode: "kodowanie promptu",
    CLIPVisionEncode: "kodowanie obrazu (vision)",
    WanImageToVideo: "przygotowanie Wan I2V",
    LTXVImgToVideo: "przygotowanie LTX",
    LTXVConditioning: "conditioning LTX",
    SVD_img2vid_Conditioning: "conditioning SVD",
    FluxGuidance: "Flux guidance",
    SamplerCustomAdvanced: "sampling",
    SamplerCustom: "sampling",
    KSampler: "sampling",
    KSamplerAdvanced: "sampling",
    VAEDecode: "VAE / dekodowanie",
    VAEDecodeTiled: "VAE / dekodowanie (tiled)",
    SaveImage: "zapisywanie obrazu",
    VHS_VideoCombine: "zapisywanie wideo (VHS)",
  };
  return map[classType] ?? classType;
}

export type PhaseFormatInput = {
  stage: ProgressStage;
  nodeType?: string | null;
  step?: number | null;
  stepMax?: number | null;
  queueAhead?: number | null;
  /** np. "Wan" / "LTX" — do etykiet chunków */
  engineLabel?: string | null;
  chunkIndex?: number | null;
  chunkTotal?: number | null;
  nodesDone?: number | null;
  nodesTotal?: number | null;
};

/**
 * Konkretna etykieta po polsku, np.
 * „Wan chunk 1/2 — sampling 12/20”, „Ładowanie modeli…”, „Sklejanie mp4…”
 */
export function formatPolishPhase(input: PhaseFormatInput): string {
  const {
    stage,
    nodeType,
    step,
    stepMax,
    queueAhead,
    engineLabel,
    chunkIndex,
    chunkTotal,
  } = input;

  const chunkPrefix =
    chunkIndex != null &&
    chunkTotal != null &&
    chunkTotal > 0 &&
    stage !== "stitch" &&
    stage !== "rife" &&
    stage !== "upscale" &&
    stage !== "done" &&
    stage !== "fail"
      ? `${engineLabel ? `${engineLabel} ` : ""}chunk ${chunkIndex}/${chunkTotal} — `
      : "";

  switch (stage) {
    case "queued":
      if (queueAhead == null || queueAhead <= 0) {
        return "W kolejce Comfy (następny)…";
      }
      return `W kolejce Comfy (przed Tobą: ${queueAhead})…`;
    case "loading":
      return `${chunkPrefix}Ładowanie modeli${nodeType ? ` (${polishNodeLabel(nodeType)})` : ""}…`;
    case "prep":
      return `${chunkPrefix}${polishNodeLabel(nodeType)}…`;
    case "sampling": {
      if (
        typeof step === "number" &&
        typeof stepMax === "number" &&
        stepMax > 0
      ) {
        return `${chunkPrefix}sampling ${step}/${stepMax}`;
      }
      return `${chunkPrefix}sampling (GPU)…`;
    }
    case "vae":
      return `${chunkPrefix}VAE / dekodowanie…`;
    case "saving":
      return `${chunkPrefix}${
        nodeType && /VHS|Video|mp4/i.test(nodeType)
          ? "Zapisywanie mp4…"
          : "Zapisywanie…"
      }`;
    case "stitch":
      return "Sklejanie mp4…";
    case "rife":
      return "RIFE 16→24…";
    case "upscale":
      return "Upscale wideo…";
    case "done":
      return "Gotowe";
    case "fail":
      return "Błąd";
    case "running":
      return `${chunkPrefix}Praca na GPU${
        nodeType ? ` — ${polishNodeLabel(nodeType)}` : ""
      }…`;
    default:
      return `${chunkPrefix}Oczekiwanie na status…`;
  }
}

export type PercentInput = {
  stage: ProgressStage;
  step?: number | null;
  stepMax?: number | null;
  nodesDone?: number | null;
  nodesTotal?: number | null;
  /** Gdy true — wolimy null zamiast sztucznego % w środku etapu. */
  preferIndeterminate?: boolean;
};

/**
 * % z mapy etapów. Sampling: interpolacja step/max w zakresie etapu.
 * Bez stepów w sampling/loading → null (indeterminate), nie 25.
 */
export function percentForStage(input: PercentInput): number | null {
  const { stage, step, stepMax, nodesDone, nodesTotal, preferIndeterminate } =
    input;
  const range = STAGE_RANGE[stage] ?? STAGE_RANGE.unknown;

  if (stage === "done" || stage === "fail") return 100;
  if (stage === "unknown") return null;

  if (
    stage === "sampling" &&
    typeof step === "number" &&
    typeof stepMax === "number" &&
    stepMax > 0
  ) {
    const t = Math.min(1, Math.max(0, step / stepMax));
    return Math.round(range.lo + t * (range.hi - range.lo));
  }

  if (
    typeof nodesDone === "number" &&
    typeof nodesTotal === "number" &&
    nodesTotal > 0 &&
    (stage === "prep" || stage === "loading" || stage === "running")
  ) {
    const t = Math.min(1, Math.max(0, nodesDone / nodesTotal));
    return Math.round(8 + t * 75);
  }

  if (range.indeterminate || preferIndeterminate) {
    // Pokaż dolny próg etapu tylko gdy mamy pewność etapu — inaczej null
    if (stage === "queued") return range.lo;
    if (stage === "stitch" || stage === "rife" || stage === "upscale") {
      return range.lo;
    }
    // loading / prep / sampling bez step / vae / saving / running → indeterminate
    // (UI: pasek pulse + etykieta etapu, bez kłamliwego %)
    return null;
  }

  return range.lo;
}

export function engineLabelFromId(
  engine: string | null | undefined
): string | null {
  if (!engine) return null;
  if (engine === "wan") return "Wan";
  if (engine === "ltx") return "LTX";
  if (engine === "svd") return "SVD";
  return engine;
}
