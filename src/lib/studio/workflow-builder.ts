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
import txt2imgFluxTemplate from "./workflows/txt2img-flux.json";
import txt2imgTemplate from "./workflows/txt2img-sdxl.json";
import txt2videoTemplate from "./workflows/txt2video-svd.json";

export { DEFAULT_SDXL_NEGATIVE } from "./defaults";

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

/** Buduje workflow ComfyUI API z pól formularza. */
export function buildWorkflow(body: GenerateBody): {
  workflow: WorkflowGraph;
  template: string;
  engine: "flux" | "sdxl" | "svd";
} {
  if (body.kind === "video") {
    return {
      workflow: buildVideoWorkflow(body),
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

/**
 * Flux.2 Dev (fp8): UNETLoader + CLIPLoader(type=flux2) + VAE + FluxGuidance
 * + Flux2Scheduler + EmptyFlux2LatentImage + SamplerCustomAdvanced.
 * Uproszczone względem blueprintu (bez turbo LoRA / ComfySwitch).
 * Negatyw klasyczny nie jest używany.
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

export const VIDEO_UI_LIMITS = {
  maxDurationSec: 60,
  maxWidth: 576,
  maxHeight: 576,
  maxFps: 30,
  /** Schema Comfy: video_frames 1–4096; poniżej = miękkie ostrzeżenie VRAM, nie hard-block */
  schemaMaxFrames: 4096,
  minFramesSvd: 1,
  /** Powyżej tego zwykle OOM / bardzo długo na SVD XT 16GB */
  comfortDurationSec: 4,
  comfortFps: 12,
  comfortFrames: 25,
  note: "Wymaga SVD + Video Helper Suite (VHS). Obraz startowy musi być w Comfy input (upload / Z galerii) — sama nazwa z output nie przejdzie walidacji LoadImage. Na ~16 GB VRAM realistycznie krótki klip (~25 klatek).",
} as const;

/** Liczba klatek = czas × FPS (integer, jak wymaga SVD). */
export function estimateVideoFrames(durationSec: number, fps: number): number {
  return Math.max(
    VIDEO_UI_LIMITS.minFramesSvd,
    Math.round(durationSec * fps)
  );
}

export type SvdVideoPlan = {
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  frames: number;
  vramRisky: boolean;
};

export function planSvdVideo(body: {
  width?: number;
  height?: number;
  fps?: number;
  durationSec?: number;
}): SvdVideoPlan {
  // width/height: step 8 (wymóg SVD_img2vid_Conditioning)
  const width =
    Math.round(
      Math.min(body.width ?? 512, VIDEO_UI_LIMITS.maxWidth) / 8
    ) * 8;
  const height =
    Math.round(
      Math.min(body.height ?? 512, VIDEO_UI_LIMITS.maxHeight) / 8
    ) * 8;
  const fps = Math.min(
    Math.max(Math.round(body.fps ?? 6), 1),
    VIDEO_UI_LIMITS.maxFps
  );
  const durationSec = Math.min(
    Math.max(body.durationSec ?? 2, 1),
    VIDEO_UI_LIMITS.maxDurationSec
  );
  const frames = Math.min(
    estimateVideoFrames(durationSec, fps),
    VIDEO_UI_LIMITS.schemaMaxFrames
  );

  return {
    width: Math.max(16, width),
    height: Math.max(16, height),
    fps,
    durationSec,
    frames,
    vramRisky:
      frames > VIDEO_UI_LIMITS.comfortFrames ||
      durationSec > VIDEO_UI_LIMITS.comfortDurationSec ||
      fps > VIDEO_UI_LIMITS.comfortFps,
  };
}

/**
 * SVD img2vid — LoadImage musi dostać plik z **input**.
 * video_frames/fps jako INT; width/height wielokrotność 8.
 */
function buildVideoWorkflow(body: GenerateBody): WorkflowGraph {
  const graph = asGraph(txt2videoTemplate);
  const ckpt = body.model?.trim() || "svd_xt.safetensors";
  const seed =
    body.seed === undefined || body.seed < 0
      ? Math.floor(Math.random() * 2_147_483_647)
      : body.seed;

  const plan = planSvdVideo(body);

  graph["1"].inputs.ckpt_name = ckpt;
  graph["2"].inputs.image = body.startImage?.trim() || "start.png";
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

  return graph;
}
