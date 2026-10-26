import type { GenerateBody } from "./schemas";
import { getDefaultCheckpoint } from "./config";
import { DEFAULT_SDXL_NEGATIVE, DEFAULT_WAN_NEGATIVE } from "./defaults";
import {
  DEFAULT_FLUX_CLIP_TYPE,
  DEFAULT_FLUX_GUIDANCE,
  DEFAULT_FLUX_STEPS,
  getFluxClipName,
  getFluxUnetName,
  getFluxVaeName,
  getFluxWeightDtype,
  isFluxModel,
} from "./flux";
import {
  DEFAULT_CODEFORMER,
  DEFAULT_LTX_CHECKPOINT,
  DEFAULT_LTX_CLIP,
  DEFAULT_VIDEO_ENGINE,
  DEFAULT_WAN_CLIP,
  DEFAULT_WAN_CLIP_VISION,
  DEFAULT_WAN_VAE,
  LTX_UI_LIMITS,
  SVD_UI_LIMITS,
  WAN_UI_LIMITS,
  H3_LITE_UI_LIMITS,
  clampH3LiteDuration,
  effectiveDurationSec,
  maxLtxDurationAtFps,
  maxWanDurationAtFps,
  preferredWanChunkLength,
  resolveWanUnet,
  snapLtxLength,
  snapWanFps,
  snapWanLength,
  type VideoEngineId,
} from "./video-engines";
import {
  detectWan22Availability,
  isWan22FastMoeEnabled,
  WAN22_FAST_CFG,
  WAN22_FAST_HIGH_END_STEP,
  WAN22_FAST_LORA_STRENGTH,
  WAN22_FAST_LOW_END_STEP,
  WAN22_FAST_SAMPLER,
  WAN22_FAST_SCHEDULER,
  WAN22_FAST_SHIFT,
  WAN22_FAST_STEPS,
  WAN22_MOE_UNSTABLE_NOTE,
  type Wan22Detect,
} from "./wan22";
import { LTX_CHUNK_OVERLAP, planLtxChunks, type LtxChunkPlan } from "./ltx-chunks";
import { WAN_CHUNK_OVERLAP, planWanChunks } from "./wan-chunks";
import txt2imgFluxTemplate from "./workflows/txt2img-flux.json";
import txt2imgTemplate from "./workflows/txt2img-sdxl.json";
import txt2videoLtxTemplate from "./workflows/txt2video-ltx.json";
import txt2videoSvdTemplate from "./workflows/txt2video-svd.json";
import txt2videoWanTemplate from "./workflows/txt2video-wan.json";

export type { LtxChunkPlan } from "./ltx-chunks";
export { planLtxChunks } from "./ltx-chunks";
export { planWanChunks } from "./wan-chunks";

export { DEFAULT_SDXL_NEGATIVE } from "./defaults";
export {
  DEFAULT_VIDEO_ENGINE,
  DEFAULT_WAN_UNET,
  DEFAULT_WAN_UNET_720P,
  DEFAULT_WAN_CLIP,
  DEFAULT_WAN_VAE,
  DEFAULT_WAN_CLIP_VISION,
  DEFAULT_LTX_CHECKPOINT,
  DEFAULT_LTX_CLIP,
  DEFAULT_CODEFORMER,
  WAN_UI_LIMITS,
  WAN_FPS_OPTIONS,
  WAN_CHUNK_SMOKE,
  WAN_CHUNK_MID,
  WAN_CHUNK_QUALITY_720,
  WAN_CHUNK_PREFERRED_FAST,
  WAN_CHUNK_LENGTH_OPTIONS,
  LTX_UI_LIMITS,
  H3_LITE_UI_LIMITS,
  H3_LITE_USD_PER_SEC,
  MINIMAX_API_KEY_ENV,
  MINIMAX_H3_LITE_MODEL,
  SVD_UI_LIMITS,
  VIDEO_ENGINE_OPTIONS,
  clampH3LiteDuration,
  h3LiteEstimatedUsd,
  videoEngineSkipsComfyHealth,
  snapWanLength,
  snapWanFps,
  snapLtxLength,
  maxWanDurationAtFps,
  maxLtxDurationAtFps,
  effectiveDurationSec,
  isChunkedVideoEngine,
  preferredWanChunkLength,
  resolveWanUnet,
  type VideoEngineId,
  type WanChunkLengthOption,
} from "./video-engines";
export {
  detectWan22Availability,
  isWan22FastMoeEnabled,
  WAN22_I2V_HIGH_NOISE_FP8,
  WAN22_I2V_LOW_NOISE_FP8,
  WAN22_I2V_HIGH_NOISE_FP8_FUSED,
  WAN22_I2V_LOW_NOISE_FP8_FUSED,
  WAN22_LIGHTX2V_LORA_HIGH,
  WAN22_LIGHTX2V_LORA_LOW,
  WAN22_HF_DISTILL,
  WAN22_HF_COMFY_ORG,
  WAN22_FAST_STEPS,
  WAN22_FAST_CFG,
  WAN22_FAST_SAMPLER,
  WAN22_FAST_SCHEDULER,
  WAN22_FAST_SHIFT,
  WAN22_MOE_UNSTABLE_NOTE,
  type Wan22Detect,
} from "./wan22";

export { DEFAULT_WAN_NEGATIVE } from "./defaults";
export {
  DEFAULT_WAN_QUALITY_PRESET,
  DEFAULT_WAN_FAST_STEPS,
  WAN_QUALITY_PRESETS,
  WAN_QUALITY_PRESETS_UI,
  getWanQualityPreset,
  type WanQualityPreset,
  type WanQualityPresetId,
} from "./video-presets";
export {
  WAN_DISTILL_LORA_FILENAME,
  WAN_DISTILL_STEPS_MAX,
  WAN_DISTILL_STEPS_MIN,
  clampWanDistillSteps,
  coerceWanFast480pGeometry,
  resolveWanDistillLora,
  wantsWanDistill,
} from "./wan-distill";
export {
  VIDEO_ORIENTATION_LAST_KEY,
  VIDEO_ORIENTATION_OPTIONS,
  VIDEO_ORIENTATION_STORAGE_KEY,
  applyWanOrientationSize,
  parseVideoOrientationMode,
  parseVideoOrientationResolved,
  resolveVideoOrientation,
  wanFastSize,
  wanQuality720Size,
  wanSizeForOrientation,
  type VideoOrientationMode,
  type VideoOrientationResolved,
} from "./video-orientation";
import {
  WAN_DISTILL_CFG,
  WAN_DISTILL_SAMPLER,
  WAN_DISTILL_SCHEDULER,
  WAN_DISTILL_STEPS,
  WAN_DISTILL_STRENGTH,
  WAN_FAST_NO_LORA_CFG,
  WAN_FAST_NO_LORA_SAMPLER,
  WAN_FAST_NO_LORA_SCHEDULER,
  WAN_FAST_NO_LORA_STEPS,
  clampWanDistillSteps,
  coerceWanFast480pGeometry,
  resolveWanDistillLora,
  wantsWanDistill,
} from "./wan-distill";
import { applyWanOrientationSize } from "./video-orientation";
import {
  WAN_SAGE_ATTENTION_MODE,
  WAN_SAGE_NODE_CLASS,
  resolveWanSageAttentionNode,
} from "./wan-sage";
import { getWanQualityPreset } from "./video-presets";
import { comfyHasNodeClass } from "./comfy-client";

/** Node wymagany przez Wan 2.2 MoE (dual KSamplerAdvanced). Brak → Wan 2.1. */
const WAN22_MOE_REQUIRED_NODE = "KSamplerAdvanced";

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

type WorkflowNode = {
  class_type: string;
  inputs: Record<string, unknown>;
};

type WorkflowGraph = Record<string, WorkflowNode>;

function asGraph(raw: unknown): WorkflowGraph {
  const clone = deepClone(raw) as Record<string, unknown>;
  delete clone._meta;
  return clone as WorkflowGraph;
}

function imageBasename(raw: string | undefined): string {
  const v = raw?.trim() || "start.png";
  return v.includes("/") ? v.slice(v.lastIndexOf("/") + 1) : v;
}

export type BuildWorkflowResult = {
  workflow: WorkflowGraph;
  template: string;
  engine: "flux" | "sdxl" | "svd" | "ltx" | "wan";
  /** Ostrzeżenia (np. brak LoRA distill) — UI / pipeline może dołączyć. */
  warnings?: string[];
};

/** Buduje workflow ComfyUI API z pól formularza (async — sprawdza LoRA na Comfy). */
export async function buildWorkflow(
  body: GenerateBody
): Promise<BuildWorkflowResult> {
  if (body.kind === "video") {
    const engine = resolveVideoEngine(body);
    if (engine === "h3-lite") {
      throw new Error(
        "MiniMax-H3-Lite idzie przez API pay-as-you-go, nie przez workflow ComfyUI."
      );
    }
    if (engine === "wan") {
      const { workflow, warnings } = await buildWanVideoWorkflow(body);
      return {
        workflow,
        template: "txt2video-wan",
        engine: "wan",
        warnings,
      };
    }
    if (engine === "ltx") {
      return {
        workflow: buildLtxVideoWorkflow(body),
        template: "txt2video-ltx",
        engine: "ltx",
      };
    }
    return {
      workflow: buildSvdVideoWorkflow(body),
      template: "txt2video-svd",
      engine: "svd",
    };
  }
  if (isFluxModel(body.model)) {
    return {
      workflow: buildFluxImageWorkflow(body),
      template: "txt2img-flux2",
      engine: "flux",
    };
  }
  return {
    workflow: buildSdxlImageWorkflow(body),
    template: "txt2img-sdxl",
    engine: "sdxl",
  };
}

export function resolveVideoEngine(body: {
  videoEngine?: string;
  model?: string;
}): VideoEngineId {
  if (
    body.videoEngine === "h3-lite" ||
    body.videoEngine === "svd" ||
    body.videoEngine === "ltx" ||
    body.videoEngine === "wan"
  ) {
    return body.videoEngine;
  }
  const m = body.model?.toLowerCase() ?? "";
  if (m.includes("svd")) return "svd";
  if (m.includes("ltx")) return "ltx";
  if (m.includes("wan")) return "wan";
  return DEFAULT_VIDEO_ENGINE;
}

/**
 * Flux.2 Dev (fp8): UNETLoader + CLIPLoader(type=flux2) + VAE + FluxGuidance
 * + Flux2Scheduler + EmptyFlux2LatentImage + SamplerCustomAdvanced.
 */
function buildFluxImageWorkflow(body: GenerateBody): WorkflowGraph {
  const graph = asGraph(txt2imgFluxTemplate);
  const seed =
    body.seed === undefined || body.seed < 0
      ? Math.floor(Math.random() * 2_147_483_647)
      : body.seed;

  const width = body.width ?? 1024;
  const height = body.height ?? 1024;
  const steps = body.steps ?? DEFAULT_FLUX_STEPS;
  const guidance = body.cfg ?? DEFAULT_FLUX_GUIDANCE;

  const unet =
    body.model?.trim() && body.model.trim().toLowerCase() !== "flux"
      ? body.model.trim()
      : getFluxUnetName();

  graph["122"].inputs.unet_name = unet;
  graph["122"].inputs.weight_dtype = getFluxWeightDtype();
  graph["111"].inputs.clip_name = getFluxClipName();
  graph["111"].inputs.type = DEFAULT_FLUX_CLIP_TYPE;
  graph["111"].inputs.device = "default";
  graph["108"].inputs.vae_name = getFluxVaeName();
  graph["115"].inputs.text = body.prompt;
  graph["106"].inputs.guidance = guidance;
  graph["113"].inputs.width = width;
  graph["113"].inputs.height = height;
  graph["113"].inputs.batch_size = body.batch ?? 1;
  graph["112"].inputs.steps = steps;
  graph["112"].inputs.width = width;
  graph["112"].inputs.height = height;
  graph["114"].inputs.noise_seed = seed;

  return graph;
}

function buildSdxlImageWorkflow(body: GenerateBody): WorkflowGraph {
  const graph = asGraph(txt2imgTemplate);
  const ckpt = body.model?.trim() || getDefaultCheckpoint();
  const seed =
    body.seed === undefined || body.seed < 0
      ? Math.floor(Math.random() * 2_147_483_647)
      : body.seed;

  graph["4"].inputs.ckpt_name = ckpt;
  graph["5"].inputs.width = body.width ?? 1024;
  graph["5"].inputs.height = body.height ?? 1024;
  graph["5"].inputs.batch_size = body.batch ?? 1;
  graph["6"].inputs.text = body.prompt;
  graph["7"].inputs.text =
    body.negativePrompt?.trim() || DEFAULT_SDXL_NEGATIVE;
  graph["3"].inputs.seed = seed;
  graph["3"].inputs.steps = body.steps ?? 30;
  graph["3"].inputs.cfg = body.cfg ?? 5.5;
  graph["3"].inputs.sampler_name = "dpmpp_2m";
  graph["3"].inputs.scheduler = "karras";

  return graph;
}

/** @deprecated użyj WAN/LTX/SVD_UI_LIMITS — zostawione dla starych importów */
export const VIDEO_UI_LIMITS = {
  ...SVD_UI_LIMITS,
  schemaMaxFrames: SVD_UI_LIMITS.schemaMaxFrames,
  minFramesSvd: SVD_UI_LIMITS.minFrames,
  comfortFrames: SVD_UI_LIMITS.comfortFrames,
  note: `${WAN_UI_LIMITS.note} ${LTX_UI_LIMITS.note} ${SVD_UI_LIMITS.note}`,
} as const;

export function estimateVideoFrames(durationSec: number, fps: number): number {
  return Math.max(1, Math.round(durationSec * fps));
}

export type VideoPlan = {
  engine: VideoEngineId;
  width: number;
  height: number;
  fps: number;
  /** Czas zadany przez usera (po clamp UI maxDurationSec). */
  durationSec: number;
  /** Faktyczna długość po stitch = uniqueFrames/fps */
  effectiveDurationSec: number;
  /** Unikalne klatki w finalnym mp4 (po overlap) */
  frames: number;
  /** true gdy UI musiał przyciąć czas do maxDurationSec */
  durationClamped: boolean;
  /** Max s jednego chunka przy FPS (121/fps) — nie limituje długiego wideo */
  maxDurationAtFps: number;
  vramRisky: boolean;
  /** Plan chunków Wan/LTX (1 = bez dzielenia) */
  chunkPlan?: LtxChunkPlan;
};

export type SvdVideoPlan = VideoPlan;

export function planVideo(body: {
  videoEngine?: string;
  model?: string;
  width?: number;
  height?: number;
  fps?: number;
  durationSec?: number;
  maxPerChunk?: number;
}): VideoPlan {
  const engine = resolveVideoEngine(body);
  if (engine === "h3-lite") return planH3LiteVideo(body);
  if (engine === "wan") return planWanVideo(body);
  if (engine === "ltx") return planLtxVideo(body);
  return planSvdVideo(body);
}

/** Jedno wywołanie MiniMax-H3-Lite. Bez chunków, RIFE i upscale. */
export function planH3LiteVideo(body: { durationSec?: number }): VideoPlan {
  const requested = body.durationSec ?? H3_LITE_UI_LIMITS.defaultDurationSec;
  const durationSec = clampH3LiteDuration(
    typeof requested === "number" ? requested : undefined
  );
  const fps = H3_LITE_UI_LIMITS.defaultFps;
  return {
    engine: "h3-lite",
    width: H3_LITE_UI_LIMITS.defaultWidth,
    height: H3_LITE_UI_LIMITS.defaultHeight,
    fps,
    durationSec,
    effectiveDurationSec: durationSec,
    frames: durationSec * fps,
    durationClamped: Math.abs(requested - durationSec) > 0.05,
    maxDurationAtFps: H3_LITE_UI_LIMITS.maxDurationSec,
    vramRisky: false,
  };
}

export function planSvdVideo(body: {
  width?: number;
  height?: number;
  fps?: number;
  durationSec?: number;
}): VideoPlan {
  const width =
    Math.round(
      Math.min(body.width ?? SVD_UI_LIMITS.defaultWidth, SVD_UI_LIMITS.maxWidth) /
        8
    ) * 8;
  const height =
    Math.round(
      Math.min(
        body.height ?? SVD_UI_LIMITS.defaultHeight,
        SVD_UI_LIMITS.maxHeight
      ) / 8
    ) * 8;
  const fps = Math.min(
    Math.max(Math.round(body.fps ?? SVD_UI_LIMITS.defaultFps), 1),
    SVD_UI_LIMITS.maxFps
  );
  const maxDurationAtFps = SVD_UI_LIMITS.maxDurationSec;
  const requested = Math.max(
    body.durationSec ?? SVD_UI_LIMITS.defaultDurationSec,
    1
  );
  const durationSec = Math.min(requested, maxDurationAtFps);
  const frames = Math.min(
    estimateVideoFrames(durationSec, fps),
    SVD_UI_LIMITS.schemaMaxFrames
  );
  const effective = effectiveDurationSec(frames, fps);

  return {
    engine: "svd",
    width: Math.max(16, width),
    height: Math.max(16, height),
    fps,
    durationSec,
    effectiveDurationSec: effective,
    frames,
    durationClamped: requested > maxDurationAtFps + 0.05,
    maxDurationAtFps,
    vramRisky:
      frames > SVD_UI_LIMITS.comfortFrames ||
      effective > SVD_UI_LIMITS.comfortDurationSec ||
      fps > SVD_UI_LIMITS.comfortFps,
  };
}

export function planWanVideo(body: {
  width?: number;
  height?: number;
  fps?: number;
  durationSec?: number;
  model?: string;
  /** UI / API override max klatek/chunk (4n+1). Domyślnie: Fast 81 / Quality720 65. */
  maxPerChunk?: number;
}): VideoPlan {
  const width =
    Math.round(
      Math.min(body.width ?? WAN_UI_LIMITS.defaultWidth, WAN_UI_LIMITS.maxWidth) /
        16
    ) * 16;
  const height =
    Math.round(
      Math.min(
        body.height ?? WAN_UI_LIMITS.defaultHeight,
        WAN_UI_LIMITS.maxHeight
      ) / 16
    ) * 16;
  // UI: 16 | 24; requestedFrames = duration × fps → prefer 81 Fast / 65 @720p
  const fps = snapWanFps(
    Math.min(
      Math.max(Math.round(body.fps ?? WAN_UI_LIMITS.defaultFps), 1),
      WAN_UI_LIMITS.maxFps
    )
  );
  const maxChunkDuration = maxWanDurationAtFps(fps);
  const requested = Math.max(
    body.durationSec ?? WAN_UI_LIMITS.defaultDurationSec,
    1
  );
  const durationSec = Math.min(requested, WAN_UI_LIMITS.maxDurationSec);
  const requestedFrames = estimateVideoFrames(durationSec, fps);
  const maxPerChunk = preferredWanChunkLength({
    width,
    height,
    model: body.model,
    override: body.maxPerChunk,
  });
  const chunkPlan = planWanChunks(requestedFrames, fps, { maxPerChunk });
  const frames = chunkPlan.totalUniqueFrames;
  const effective = chunkPlan.effectiveDurationSec;
  const shortSide = Math.min(width, height);
  const longSide = Math.max(width, height);
  const is720 = shortSide >= 640 || longSide >= 1024;
  const comfort = is720
    ? WAN_UI_LIMITS.comfortLength720
    : WAN_UI_LIMITS.comfortLength;

  return {
    engine: "wan",
    width: Math.max(64, width),
    height: Math.max(64, height),
    fps,
    durationSec,
    effectiveDurationSec: effective,
    frames,
    durationClamped: requested > WAN_UI_LIMITS.maxDurationSec + 0.05,
    maxDurationAtFps: maxChunkDuration,
    // Fast 480p @81 = OK; Quality 720p @>65 lub sam 720p = ostrzeżenie
    vramRisky:
      chunkPlan.chunks.some((c) => c.length > comfort) || is720,
    chunkPlan,
  };
}

export function planLtxVideo(body: {
  width?: number;
  height?: number;
  fps?: number;
  durationSec?: number;
}): VideoPlan {
  const width =
    Math.round(
      Math.min(body.width ?? LTX_UI_LIMITS.defaultWidth, LTX_UI_LIMITS.maxWidth) /
        32
    ) * 32;
  const height =
    Math.round(
      Math.min(
        body.height ?? LTX_UI_LIMITS.defaultHeight,
        LTX_UI_LIMITS.maxHeight
      ) / 32
    ) * 32;
  const fps = Math.min(
    Math.max(Math.round(body.fps ?? LTX_UI_LIMITS.defaultFps), 1),
    LTX_UI_LIMITS.maxFps
  );
  const maxChunkDuration = maxLtxDurationAtFps(fps);
  const requested = Math.max(
    body.durationSec ?? LTX_UI_LIMITS.defaultDurationSec,
    1
  );
  const durationSec = Math.min(requested, LTX_UI_LIMITS.maxDurationSec);
  const requestedFrames = estimateVideoFrames(durationSec, fps);
  const chunkPlan = planLtxChunks(requestedFrames, fps);
  const frames = chunkPlan.totalUniqueFrames;
  const effective = chunkPlan.effectiveDurationSec;

  return {
    engine: "ltx",
    width: Math.max(64, width),
    height: Math.max(64, height),
    fps,
    durationSec,
    effectiveDurationSec: effective,
    frames,
    durationClamped: requested > LTX_UI_LIMITS.maxDurationSec + 0.05,
    maxDurationAtFps: maxChunkDuration,
    // Chunki ≤121 = Legion SAFE; ostrzegaj tylko gdy pojedynczy odcinek > comfort
    vramRisky: chunkPlan.chunks.some(
      (c) => c.length > LTX_UI_LIMITS.comfortLength
    ),
    chunkPlan,
  };
}

function buildSvdVideoWorkflow(body: GenerateBody): WorkflowGraph {
  const graph = asGraph(txt2videoSvdTemplate);
  const ckpt = body.model?.trim() || "svd_xt.safetensors";
  const seed =
    body.seed === undefined || body.seed < 0
      ? Math.floor(Math.random() * 2_147_483_647)
      : body.seed;

  const plan = planSvdVideo(body);

  graph["1"].class_type = "ImageOnlyCheckpointLoader";
  graph["1"].inputs.ckpt_name = ckpt;
  graph["2"].class_type = "LoadImage";
  graph["2"].inputs.image = imageBasename(body.startImage);
  graph["3"].inputs.width = plan.width;
  graph["3"].inputs.height = plan.height;
  graph["3"].inputs.video_frames = plan.frames;
  graph["3"].inputs.fps = plan.fps;
  graph["3"].inputs.motion_bucket_id = 127;
  graph["3"].inputs.augmentation_level = 0;
  graph["4"].inputs.seed = seed;
  graph["4"].inputs.steps = body.steps ?? 20;
  graph["4"].inputs.cfg = body.cfg ?? 2.5;
  graph["6"].inputs.frame_rate = plan.fps;

  if (body.faceRestore) {
    spliceFaceRestore(graph, "5", "6", body.faceRestoreFidelity);
  }

  return graph;
}

/**
 * Wan I2V — Fast domyślnie Wan 2.1 UNET + lightx2v distill LoRA.
 * Wan 2.2 MoE tylko gdy WAN22_MOE_ENABLE=1 (RTX 5080 / sm_120 CUDA unstable).
 * CLIPLoader(type=wan) + CLIPVision + WanImageToVideo + ModelSamplingSD3
 * + KSampler(+ opcjonalnie Advanced MoE) + VHS. Opcjonalnie CodeFormer; tail.
 */
async function buildWanVideoWorkflow(body: GenerateBody): Promise<{
  workflow: WorkflowGraph;
  warnings: string[];
}> {
  const graph = asGraph(txt2videoWanTemplate);
  const warnings: string[] = [];
  const seed =
    body.seed === undefined || body.seed < 0
      ? Math.floor(Math.random() * 2_147_483_647)
      : body.seed;

  const preset = getWanQualityPreset(body.qualityPreset);
  const wantDistill =
    body.wanDistillLora !== false &&
    (body.wanDistillLora === true ||
      preset?.useDistillLora === true ||
      wantsWanDistill(body.qualityPreset));

  // Orientacja UI (Pion/Poziom/Auto) → Fast 480p / Quality 720p pair
  const oriented = applyWanOrientationSize({
    orientation: body.orientation,
    qualityPreset: body.qualityPreset,
    wanDistillLora: body.wanDistillLora,
    width: body.width,
    height: body.height,
  });

  // Fast + lightx2v = tylko 480p (nie mieszaj UNET 720p z LoRA 480p)
  // Portrait-aware: 832×480 / 480×832 (#24) + wymuszenie z orientation
  const geo = coerceWanFast480pGeometry({
    qualityPreset: body.qualityPreset,
    wanDistillLora: body.wanDistillLora,
    width: oriented.width,
    height: oriented.height,
    model: body.model,
    orientation: body.orientation,
  });
  if (geo.warning) warnings.push(geo.warning);
  const bodyForPlan: GenerateBody = {
    ...body,
    width: geo.locked ? geo.width : oriented.width,
    height: geo.locked ? geo.height : oriented.height,
    ...(geo.locked ? { model: geo.model } : {}),
  };

  const plan = planWanVideo(bodyForPlan);
  const chunkLength =
    body.ltxChunkLength != null
      ? snapWanLength(body.ltxChunkLength)
      : plan.chunkPlan && !plan.chunkPlan.chunked
        ? plan.chunkPlan.chunks[0]!.length
        : snapWanLength(plan.frames);

  const unet = resolveWanUnet({
    model: bodyForPlan.model,
    width: plan.width,
    height: plan.height,
  });

  const chunkIdx = body.ltxChunkIndex ?? 0;
  const prefix = `studio/video-wan-c${chunkIdx}`;

  graph["37"].inputs.unet_name = unet;
  graph["37"].inputs.weight_dtype = "default";
  graph["38"].inputs.clip_name = DEFAULT_WAN_CLIP;
  graph["38"].inputs.type = "wan";
  graph["39"].inputs.vae_name = DEFAULT_WAN_VAE;
  graph["49"].inputs.clip_name = DEFAULT_WAN_CLIP_VISION;
  graph["52"].inputs.image = imageBasename(body.startImage);
  graph["6"].inputs.text =
    body.prompt?.trim() ||
    "best quality, photorealistic motion, detailed, cinematic, static camera, medium shot";
  graph["7"].inputs.text =
    body.negativePrompt?.trim() || DEFAULT_WAN_NEGATIVE;
  graph["50"].inputs.width = plan.width;
  graph["50"].inputs.height = plan.height;
  graph["50"].inputs.length = chunkLength;
  graph["3"].inputs.seed = seed;

  let steps =
    body.steps ??
    preset?.steps ??
    (wantDistill ? WAN_DISTILL_STEPS : WAN_FAST_NO_LORA_STEPS);
  let cfg =
    body.cfg ??
    preset?.cfg ??
    (wantDistill ? WAN_DISTILL_CFG : WAN_FAST_NO_LORA_CFG);
  let samplerName =
    preset?.samplerName ??
    (wantDistill ? WAN_DISTILL_SAMPLER : WAN_FAST_NO_LORA_SAMPLER);
  let scheduler =
    preset?.scheduler ??
    (wantDistill ? WAN_DISTILL_SCHEDULER : WAN_FAST_NO_LORA_SCHEDULER);

  let usedWan22Moe = false;

  if (wantDistill) {
    // Wan 2.2 MoE opt-in only (WAN22_MOE_ENABLE) — default Fast = Wan 2.1
    let w22: Wan22Detect | null = null;
    try {
      w22 = await detectWan22Availability();
    } catch {
      w22 = null;
    }

    const moeOptIn = isWan22FastMoeEnabled();
    if (
      moeOptIn &&
      w22?.fastMoeReady &&
      w22.highNoise &&
      w22.lowNoise
    ) {
      // MoE wymaga KSamplerAdvanced — gdy Legion object_info go nie ma,
      // spadamy na Wan 2.1 Fast z jasnym komunikatem (nie SVD nonsense).
      let moeNodeOk = false;
      try {
        moeNodeOk = await comfyHasNodeClass(WAN22_MOE_REQUIRED_NODE);
      } catch {
        moeNodeOk = false;
      }
      if (!moeNodeOk) {
        if (chunkIdx === 0) {
          warnings.push(
            `Wan 2.2 MoE niedostępne — brak node’a ${WAN22_MOE_REQUIRED_NODE} w Comfy object_info. Fast = Wan 2.1 + lightx2v (gdy LoRA jest). Zaktualizuj ComfyUI na Legionie.`
          );
        }
      } else {
        const sage = await resolveWanSageAttentionNode();
        applyWan22FastMoeGraph(graph, {
          highNoise: w22.highNoise,
          lowNoise: w22.lowNoise,
          loraHigh: w22.loraHigh,
          loraLow: w22.loraLow,
          seed,
          sage: sage.available,
        });
        usedWan22Moe = true;
        steps = WAN22_FAST_STEPS;
        cfg = WAN22_FAST_CFG;
        samplerName = WAN22_FAST_SAMPLER;
        scheduler = WAN22_FAST_SCHEDULER;
        if (chunkIdx === 0) {
          warnings.push(w22.note);
        }
      }
    } else if (chunkIdx === 0 && !moeOptIn) {
      // Always tell UI Fast prefers 2.1 while MoE unstable on RTX 5080
      warnings.push(WAN22_MOE_UNSTABLE_NOTE);
    }
    if (!usedWan22Moe) {
      const distill = await resolveWanDistillLora();
      if (distill.attach && distill.loraName) {
        spliceWanDistillLora(graph, distill.loraName);
        // LoRA aktywna: twardy lock — API/UI nie nadpiszą cfg=6 ani steps poza 4–8
        steps = clampWanDistillSteps(body.steps ?? WAN_DISTILL_STEPS);
        cfg = WAN_DISTILL_CFG;
        samplerName = WAN_DISTILL_SAMPLER;
        scheduler = WAN_DISTILL_SCHEDULER;
      } else {
        if (distill.warning) warnings.push(distill.warning);
        // Graceful: bez LoRA — klasyczny Fast (ignoruj distill steps/CFG z UI)
        steps = WAN_FAST_NO_LORA_STEPS;
        cfg = WAN_FAST_NO_LORA_CFG;
        samplerName = WAN_FAST_NO_LORA_SAMPLER;
        scheduler = WAN_FAST_NO_LORA_SCHEDULER;
      }
      // Fast 2.1: Patch Sage Attention KJ gdy dostępny (nie CLI --use-sage-attention)
      const sage = await resolveWanSageAttentionNode();
      if (sage.available) {
        spliceWanSageAttention(graph);
      }
      if (chunkIdx === 0 && w22?.available && w22.usingFallback21) {
        warnings.push(w22.note);
      }
    }
  } else {
    steps = body.steps ?? preset?.steps ?? 18;
    cfg = body.cfg ?? preset?.cfg ?? 6;
    samplerName = preset?.samplerName ?? "uni_pc";
    scheduler = preset?.scheduler ?? "simple";
  }

  if (!usedWan22Moe) {
    graph["3"].inputs.steps = steps;
    graph["3"].inputs.cfg = cfg;
    graph["3"].inputs.sampler_name = samplerName;
    graph["3"].inputs.scheduler = scheduler;
  }
  graph["21"].inputs.frame_rate = plan.fps;
  graph["21"].inputs.filename_prefix = prefix;

  let imageSourceForTail: string = "8";
  if (body.faceRestore) {
    spliceFaceRestore(graph, "8", "21", body.faceRestoreFidelity);
    imageSourceForTail = "91";
  }

  // Chunk >0: drop overlapping start frame in Comfy (ImageFromBatch index 1)
  // zanim VHS — ffmpeg stitch może wtedy -c copy bez trim/re-encode.
  // length must be >=1 (Comfy rejects length=-1 / “rest of batch”).
  if (chunkIdx > 0) {
    spliceSkipOverlapFrames(graph, "21", chunkLength, WAN_CHUNK_OVERLAP);
  }

  if (body.ltxSaveTail) {
    graph["22"] = {
      class_type: "ImageFromBatch",
      inputs: {
        image: [imageSourceForTail, 0],
        batch_index: Math.max(0, chunkLength - 1),
        length: 1,
      },
    };
    graph["23"] = {
      class_type: "SaveImage",
      inputs: {
        images: ["22", 0],
        filename_prefix: `studio/wan-tail-c${chunkIdx}`,
      },
    };
  }

  return { workflow: graph, warnings };
}

/**
 * Wan 2.2 Fast MoE — dual UNET (high/low) + optional lightx2v LoRAs +
 * optional Sage KJ → ModelSamplingSD3(shift=5) + 2× KSamplerAdvanced.
 * High: steps 0→2 of 4, leftover noise. Low: 2→4, no add noise.
 * Chain order matches Comfy-Org / PainterI2V lightx2v: LoRA → Sage → SD3.
 * VAEDecode czyta z low sampler (61).
 */
export function applyWan22FastMoeGraph(
  graph: WorkflowGraph,
  opts: {
    highNoise: string;
    lowNoise: string;
    loraHigh: string | null;
    loraLow: string | null;
    seed: number;
    sage: boolean;
  }
): void {
  graph["37"] = {
    class_type: "UNETLoader",
    inputs: {
      unet_name: opts.highNoise,
      weight_dtype: "default",
    },
  };
  graph["57"] = {
    class_type: "UNETLoader",
    inputs: {
      unet_name: opts.lowNoise,
      weight_dtype: "default",
    },
  };

  let highModel: [string, number] = ["37", 0];
  let lowModel: [string, number] = ["57", 0];

  if (opts.loraHigh && opts.loraLow) {
    graph["55"] = {
      class_type: "LoraLoaderModelOnly",
      inputs: {
        model: highModel,
        lora_name: opts.loraHigh,
        strength_model: WAN22_FAST_LORA_STRENGTH,
      },
    };
    graph["58"] = {
      class_type: "LoraLoaderModelOnly",
      inputs: {
        model: lowModel,
        lora_name: opts.loraLow,
        strength_model: WAN22_FAST_LORA_STRENGTH,
      },
    };
    highModel = ["55", 0];
    lowModel = ["58", 0];
  } else {
    delete graph["55"];
    delete graph["58"];
  }

  // Sage before ModelSamplingSD3 (Comfy-Org / PainterI2V lightx2v order)
  if (opts.sage) {
    graph["56"] = {
      class_type: WAN_SAGE_NODE_CLASS,
      inputs: {
        model: highModel,
        sage_attention: WAN_SAGE_ATTENTION_MODE,
        allow_compile: false,
      },
    };
    graph["59"] = {
      class_type: WAN_SAGE_NODE_CLASS,
      inputs: {
        model: lowModel,
        sage_attention: WAN_SAGE_ATTENTION_MODE,
        allow_compile: false,
      },
    };
    highModel = ["56", 0];
    lowModel = ["59", 0];
  } else {
    delete graph["56"];
    delete graph["59"];
  }

  graph["54"] = {
    class_type: "ModelSamplingSD3",
    inputs: {
      model: highModel,
      shift: WAN22_FAST_SHIFT,
    },
  };
  graph["60"] = {
    class_type: "ModelSamplingSD3",
    inputs: {
      model: lowModel,
      shift: WAN22_FAST_SHIFT,
    },
  };
  highModel = ["54", 0];
  lowModel = ["60", 0];

  graph["3"] = {
    class_type: "KSamplerAdvanced",
    inputs: {
      add_noise: "enable",
      noise_seed: opts.seed,
      steps: WAN22_FAST_STEPS,
      cfg: WAN22_FAST_CFG,
      sampler_name: WAN22_FAST_SAMPLER,
      scheduler: WAN22_FAST_SCHEDULER,
      start_at_step: 0,
      end_at_step: WAN22_FAST_HIGH_END_STEP,
      return_with_leftover_noise: "enable",
      model: highModel,
      positive: ["50", 0],
      negative: ["50", 1],
      latent_image: ["50", 2],
    },
  };

  graph["61"] = {
    class_type: "KSamplerAdvanced",
    inputs: {
      add_noise: "disable",
      noise_seed: opts.seed,
      steps: WAN22_FAST_STEPS,
      cfg: WAN22_FAST_CFG,
      sampler_name: WAN22_FAST_SAMPLER,
      scheduler: WAN22_FAST_SCHEDULER,
      start_at_step: WAN22_FAST_HIGH_END_STEP,
      end_at_step: WAN22_FAST_LOW_END_STEP,
      return_with_leftover_noise: "disable",
      model: lowModel,
      positive: ["50", 0],
      negative: ["50", 1],
      latent_image: ["3", 0],
    },
  };

  if (graph["8"]) {
    graph["8"].inputs.samples = ["61", 0];
  }
}

/** UNET (37) → LoraLoaderModelOnly (55) → ModelSamplingSD3 (54). */
function spliceWanDistillLora(
  graph: WorkflowGraph,
  loraName: string
): void {
  graph["55"] = {
    class_type: "LoraLoaderModelOnly",
    inputs: {
      model: ["37", 0],
      lora_name: loraName,
      strength_model: WAN_DISTILL_STRENGTH,
    },
  };
  if (graph["54"]) {
    graph["54"].inputs.model = ["55", 0];
  }
}

/**
 * ModelSamplingSD3 (54) → PathchSageAttentionKJ (56) → KSampler (3).
 * Mode: sageattn_qk_int8_pv_fp16_cuda (preferowane vs CLI / triton).
 */
function spliceWanSageAttention(graph: WorkflowGraph): void {
  if (!graph["54"] || !graph["3"]) return;
  graph["56"] = {
    class_type: WAN_SAGE_NODE_CLASS,
    inputs: {
      model: ["54", 0],
      sage_attention: WAN_SAGE_ATTENTION_MODE,
      allow_compile: false,
    },
  };
  graph["3"].inputs.model = ["56", 0];
}

/**
 * LTXV 2B I2V — CheckpointLoaderSimple + CLIPLoader(type=ltxv) + LTXVImgToVideo
 * + SamplerCustom + VHS. Opcjonalnie CodeFormer; opcjonalnie zapis last-frame (chunk continue).
 */
function buildLtxVideoWorkflow(body: GenerateBody): WorkflowGraph {
  const graph = asGraph(txt2videoLtxTemplate);
  const seed =
    body.seed === undefined || body.seed < 0
      ? Math.floor(Math.random() * 2_147_483_647)
      : body.seed;

  const plan = planLtxVideo(body);
  const chunkLength =
    body.ltxChunkLength != null
      ? snapLtxLength(body.ltxChunkLength)
      : plan.chunkPlan && !plan.chunkPlan.chunked
        ? plan.chunkPlan.chunks[0]!.length
        : snapLtxLength(plan.frames);

  const ckpt =
    body.model?.trim() &&
    !body.model.toLowerCase().includes("svd") &&
    !body.model.toLowerCase().includes("wan")
      ? body.model.trim()
      : DEFAULT_LTX_CHECKPOINT;

  const chunkIdx = body.ltxChunkIndex ?? 0;
  const prefix = `studio/video-ltx-c${chunkIdx}`;

  graph["10"].inputs.ckpt_name = ckpt;
  graph["11"].inputs.clip_name = DEFAULT_LTX_CLIP;
  graph["11"].inputs.type = "ltxv";
  graph["12"].inputs.image = imageBasename(body.startImage);
  graph["13"].inputs.text =
    body.prompt?.trim() ||
    "best quality, cinematic motion, detailed, smooth camera";
  graph["14"].inputs.text =
    body.negativePrompt?.trim() ||
    "low quality, worst quality, deformed, distorted, motion smear, bad anatomy";
  graph["15"].inputs.width = plan.width;
  graph["15"].inputs.height = plan.height;
  graph["15"].inputs.length = chunkLength;
  graph["15"].inputs.strength = 1;
  graph["16"].inputs.frame_rate = plan.fps;
  graph["17"].inputs.steps = body.steps ?? 20;
  graph["19"].inputs.noise_seed = seed;
  graph["19"].inputs.cfg = body.cfg ?? 3;
  graph["21"].inputs.frame_rate = plan.fps;
  graph["21"].inputs.filename_prefix = prefix;

  let imageSourceForTail: string = "20";
  if (body.faceRestore) {
    spliceFaceRestore(graph, "20", "21", body.faceRestoreFidelity);
    imageSourceForTail = "91";
  }

  // Chunk >0: drop overlapping start frame przed VHS (jak Wan)
  if (chunkIdx > 0) {
    spliceSkipOverlapFrames(graph, "21", chunkLength, LTX_CHUNK_OVERLAP);
  }

  // Ostatnia klatka → input kolejnego chunka (Legion: last-frame continue)
  if (body.ltxSaveTail) {
    graph["22"] = {
      class_type: "ImageFromBatch",
      inputs: {
        image: [imageSourceForTail, 0],
        batch_index: Math.max(0, chunkLength - 1),
        length: 1,
      },
    };
    graph["23"] = {
      class_type: "SaveImage",
      inputs: {
        images: ["22", 0],
        filename_prefix: `studio/ltx-tail-c${chunkIdx}`,
      },
    };
  }

  return graph;
}

/**
 * Wstawia FaceRestoreModelLoader + FaceRestoreCFWithModel między decode a VHS.
 * decodeNodeId = VAEDecode; combineNodeId = VHS_VideoCombine (pole images).
 */
function spliceFaceRestore(
  graph: WorkflowGraph,
  decodeNodeId: string,
  combineNodeId: string,
  fidelity?: number
): void {
  const codeformerFidelity =
    typeof fidelity === "number" && Number.isFinite(fidelity)
      ? Math.min(1, Math.max(0, fidelity))
      : 0.5;
  graph["90"] = {
    class_type: "FaceRestoreModelLoader",
    inputs: {
      model_name: DEFAULT_CODEFORMER,
    },
  };
  graph["91"] = {
    class_type: "FaceRestoreCFWithModel",
    inputs: {
      facerestore_model: ["90", 0],
      image: [decodeNodeId, 0],
      facedetection: "retinaface_resnet50",
      codeformer_fidelity: codeformerFidelity,
    },
  };
  if (graph[combineNodeId]) {
    graph[combineNodeId].inputs.images = ["91", 0];
  }
}

/**
 * Chunk continue: pomiń pierwsze `overlap` klatek (duplikat last-frame z cN-1)
 * przed VHS_VideoCombine — unikamy ffmpeg trim + re-encode przy stitch.
 * Tail (SaveImage last frame) nadal bierze z pełnego batcha decode/face.
 *
 * Comfy core ImageFromBatch: length min=1 — never pass -1 (“rest of batch”).
 * When batchLength - overlap < 1 (single-frame edge), skip the splice.
 */
export function spliceSkipOverlapFrames(
  graph: WorkflowGraph,
  combineNodeId: string,
  batchLength: number,
  overlap: number = 1
): void {
  if (overlap <= 0) return;
  const combine = graph[combineNodeId];
  if (!combine?.inputs?.images) return;
  const keep = Math.floor(batchLength) - Math.floor(overlap);
  if (!Number.isFinite(keep) || keep < 1) {
    // Single-frame / empty after trim — leave full batch wired to VHS
    delete graph["24"];
    return;
  }
  const images = combine.inputs.images as [string, number];
  graph["24"] = {
    class_type: "ImageFromBatch",
    inputs: {
      image: images,
      batch_index: Math.floor(overlap),
      length: keep,
    },
  };
  combine.inputs.images = ["24", 0];
}

/** Collect ImageFromBatch length inputs (for smoke / CI asserts). */
export function imageFromBatchLengths(graph: WorkflowGraph): number[] {
  const out: number[] = [];
  for (const node of Object.values(graph)) {
    if (node?.class_type === "ImageFromBatch") {
      const len = node.inputs?.length;
      if (typeof len === "number") out.push(len);
    }
  }
  return out;
}
