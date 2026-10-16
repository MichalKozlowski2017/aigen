import type { GenerateBody } from "./schemas";
import { getDefaultCheckpoint } from "./config";
import { DEFAULT_SDXL_NEGATIVE } from "./defaults";
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
  LTX_UI_LIMITS,
  SVD_UI_LIMITS,
  effectiveDurationSec,
  maxLtxDurationAtFps,
  snapLtxLength,
  type VideoEngineId,
} from "./video-engines";
import txt2imgFluxTemplate from "./workflows/txt2img-flux.json";
import txt2imgTemplate from "./workflows/txt2img-sdxl.json";
import txt2videoLtxTemplate from "./workflows/txt2video-ltx.json";
import txt2videoSvdTemplate from "./workflows/txt2video-svd.json";

export { DEFAULT_SDXL_NEGATIVE } from "./defaults";
export {
  DEFAULT_VIDEO_ENGINE,
  DEFAULT_LTX_CHECKPOINT,
  DEFAULT_LTX_CLIP,
  DEFAULT_CODEFORMER,
  LTX_UI_LIMITS,
  SVD_UI_LIMITS,
  VIDEO_ENGINE_OPTIONS,
  snapLtxLength,
  maxLtxDurationAtFps,
  effectiveDurationSec,
  type VideoEngineId,
} from "./video-engines";

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

/** Buduje workflow ComfyUI API z pól formularza. */
export function buildWorkflow(body: GenerateBody): {
  workflow: WorkflowGraph;
  template: string;
  engine: "flux" | "sdxl" | "svd" | "ltx";
} {
  if (body.kind === "video") {
    const engine = resolveVideoEngine(body);
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
  if (body.videoEngine === "svd" || body.videoEngine === "ltx") {
    return body.videoEngine;
  }
  const m = body.model?.toLowerCase() ?? "";
  if (m.includes("svd")) return "svd";
  if (m.includes("ltx")) return "ltx";
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

/** @deprecated użyj SVD_UI_LIMITS / LTX_UI_LIMITS — zostawione dla starych importów */
export const VIDEO_UI_LIMITS = {
  ...SVD_UI_LIMITS,
  schemaMaxFrames: SVD_UI_LIMITS.schemaMaxFrames,
  minFramesSvd: SVD_UI_LIMITS.minFrames,
  comfortFrames: SVD_UI_LIMITS.comfortFrames,
  note: `${LTX_UI_LIMITS.note} ${SVD_UI_LIMITS.note}`,
} as const;

export function estimateVideoFrames(durationSec: number, fps: number): number {
  return Math.max(1, Math.round(durationSec * fps));
}

export type VideoPlan = {
  engine: VideoEngineId;
  width: number;
  height: number;
  fps: number;
  /** Czas zadany przez usera (po clamp UI). */
  durationSec: number;
  /** Faktyczna długość pliku = frames/fps (to idzie do Comfy / VHS). */
  effectiveDurationSec: number;
  frames: number;
  /** true gdy zadany czas > to co maxLength pozwala przy tym FPS */
  durationClamped: boolean;
  /** Max s przy bieżącym FPS */
  maxDurationAtFps: number;
  vramRisky: boolean;
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
  return engine === "ltx" ? planLtxVideo(body) : planSvdVideo(body);
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
  const maxDurationAtFps = maxLtxDurationAtFps(fps);
  const requested = Math.max(
    body.durationSec ?? LTX_UI_LIMITS.defaultDurationSec,
    1
  );
  // Nie pozwól UI „obiecać” więcej niż maxLength/fps
  const durationSec = Math.min(
    requested,
    maxDurationAtFps,
    LTX_UI_LIMITS.maxDurationSec
  );
  const requestedFrames = estimateVideoFrames(requested, fps);
  const frames = snapLtxLength(
    estimateVideoFrames(durationSec, fps)
  );
  const effective = effectiveDurationSec(frames, fps);

  return {
    engine: "ltx",
    width: Math.max(64, width),
    height: Math.max(64, height),
    fps,
    durationSec,
    effectiveDurationSec: effective,
    frames,
    durationClamped:
      requestedFrames > LTX_UI_LIMITS.maxLength ||
      requested > maxDurationAtFps + 0.05,
    maxDurationAtFps,
    vramRisky:
      frames > LTX_UI_LIMITS.comfortLength ||
      effective > LTX_UI_LIMITS.comfortDurationSec,
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
    spliceFaceRestore(graph, "5", "6");
  }

  return graph;
}

/**
 * LTXV 2B I2V — CheckpointLoaderSimple + CLIPLoader(type=ltxv) + LTXVImgToVideo
 * + SamplerCustom + VHS. Opcjonalnie CodeFormer na klatkach przed combine.
 */
function buildLtxVideoWorkflow(body: GenerateBody): WorkflowGraph {
  const graph = asGraph(txt2videoLtxTemplate);
  const seed =
    body.seed === undefined || body.seed < 0
      ? Math.floor(Math.random() * 2_147_483_647)
      : body.seed;

  const plan = planLtxVideo(body);
  const ckpt =
    body.model?.trim() && !body.model.toLowerCase().includes("svd")
      ? body.model.trim()
      : DEFAULT_LTX_CHECKPOINT;

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
  graph["15"].inputs.length = plan.frames;
  graph["15"].inputs.strength = 1;
  graph["16"].inputs.frame_rate = plan.fps;
  graph["17"].inputs.steps = body.steps ?? 20;
  graph["19"].inputs.noise_seed = seed;
  graph["19"].inputs.cfg = body.cfg ?? 3;
  graph["21"].inputs.frame_rate = plan.fps;

  if (body.faceRestore) {
    spliceFaceRestore(graph, "20", "21");
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
  combineNodeId: string
): void {
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
      codeformer_fidelity: 0.5,
    },
  };
  if (graph[combineNodeId]) {
    graph[combineNodeId].inputs.images = ["91", 0];
  }
}
