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
  effectiveDurationSec,
  maxLtxDurationAtFps,
  maxWanDurationAtFps,
  resolveWanUnet,
  snapLtxLength,
  snapWanFps,
  snapWanLength,
  type VideoEngineId,
} from "./video-engines";
import { planLtxChunks, type LtxChunkPlan } from "./ltx-chunks";
import { planWanChunks } from "./wan-chunks";
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
  LTX_UI_LIMITS,
  SVD_UI_LIMITS,
  VIDEO_ENGINE_OPTIONS,
  snapWanLength,
  snapWanFps,
  snapLtxLength,
  maxWanDurationAtFps,
  maxLtxDurationAtFps,
  effectiveDurationSec,
  isChunkedVideoEngine,
  resolveWanUnet,
  type VideoEngineId,
} from "./video-engines";

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
  resolveWanDistillLora,
  wantsWanDistill,
} from "./wan-distill";
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
  resolveWanDistillLora,
  wantsWanDistill,
} from "./wan-distill";
import { getWanQualityPreset } from "./video-presets";

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
}): VideoPlan {
  const engine = resolveVideoEngine(body);
  if (engine === "wan") return planWanVideo(body);
  if (engine === "ltx") return planLtxVideo(body);
  return planSvdVideo(body);
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
  // UI: 16 | 24; requestedFrames = duration × fps → SAFE 81 ⇒ @24/10s ~3 chunki
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
  const chunkPlan = planWanChunks(requestedFrames, fps);
  const frames = chunkPlan.totalUniqueFrames;
  const effective = chunkPlan.effectiveDurationSec;
  const is720 = width >= 1024 || height >= 640;

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
    vramRisky:
      chunkPlan.chunks.some((c) => c.length > WAN_UI_LIMITS.comfortLength) ||
      is720,
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
 * Wan 2.1 I2V — UNETLoader (FP8) + opcjonalnie LoraLoaderModelOnly (lightx2v)
 * + CLIPLoader(type=wan) + CLIPVision + WanImageToVideo + ModelSamplingSD3
 * + KSampler + VHS. Opcjonalnie CodeFormer; opcjonalnie last-frame (chunk continue).
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

  const plan = planWanVideo(body);
  const chunkLength =
    body.ltxChunkLength != null
      ? snapWanLength(body.ltxChunkLength)
      : plan.chunkPlan && !plan.chunkPlan.chunked
        ? plan.chunkPlan.chunks[0]!.length
        : snapWanLength(plan.frames);

  const unet = resolveWanUnet({
    model: body.model,
    width: plan.width,
    height: plan.height,
  });

  const chunkIdx = body.ltxChunkIndex ?? 0;
  const prefix = `studio/video-wan-c${chunkIdx}`;
  const preset = getWanQualityPreset(body.qualityPreset);
  const wantDistill =
    body.wanDistillLora !== false &&
    (body.wanDistillLora === true ||
      preset?.useDistillLora === true ||
      wantsWanDistill(body.qualityPreset));

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

  if (wantDistill) {
    const distill = await resolveWanDistillLora();
    if (distill.attach && distill.loraName) {
      spliceWanDistillLora(graph, distill.loraName);
      steps = body.steps ?? WAN_DISTILL_STEPS;
      cfg = body.cfg ?? WAN_DISTILL_CFG;
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
  } else {
    steps = body.steps ?? preset?.steps ?? 18;
    cfg = body.cfg ?? preset?.cfg ?? 6;
    samplerName = preset?.samplerName ?? "uni_pc";
    scheduler = preset?.scheduler ?? "simple";
  }

  graph["3"].inputs.steps = steps;
  graph["3"].inputs.cfg = cfg;
  graph["3"].inputs.sampler_name = samplerName;
  graph["3"].inputs.scheduler = scheduler;
  graph["21"].inputs.frame_rate = plan.fps;
  graph["21"].inputs.filename_prefix = prefix;

  let imageSourceForTail: string = "8";
  if (body.faceRestore) {
    spliceFaceRestore(graph, "8", "21", body.faceRestoreFidelity);
    imageSourceForTail = "91";
  }

  if (body.ltxSaveTail) {
    graph["22"] = {
      class_type: "ImageFromBatch",
      inputs: {
        image: [imageSourceForTail, 0],
        batch_index: -1,
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

  // Ostatnia klatka → input kolejnego chunka (Legion: last-frame continue)
  if (body.ltxSaveTail) {
    graph["22"] = {
      class_type: "ImageFromBatch",
      inputs: {
        image: [imageSourceForTail, 0],
        batch_index: -1,
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
