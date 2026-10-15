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

/**
 * SVD img2vid — limity pod ~16 GB VRAM (krótki klip, max 512).
 * Wymaga obrazu startowego w ComfyUI input (startImage) oraz Video Helper Suite (VHS_VideoCombine).
 */
function buildVideoWorkflow(body: GenerateBody): WorkflowGraph {
  const graph = asGraph(txt2videoTemplate);
  const ckpt = body.model?.trim() || "svd_xt.safetensors";
  const seed =
    body.seed === undefined || body.seed < 0
      ? Math.floor(Math.random() * 2_147_483_647)
      : body.seed;

  const width = Math.min(body.width ?? 512, 576);
  const height = Math.min(body.height ?? 512, 576);
  const fps = Math.min(body.fps ?? 6, 12);
  const durationSec = Math.min(body.durationSec ?? 2, 4);
  const frames = Math.max(8, Math.min(Math.round(durationSec * fps), 25));

  graph["1"].inputs.ckpt_name = ckpt;
  graph["2"].inputs.image = body.startImage?.trim() || "start.png";
  graph["3"].inputs.width = width;
  graph["3"].inputs.height = height;
  graph["3"].inputs.video_frames = frames;
  graph["3"].inputs.fps = fps;
  graph["4"].inputs.seed = seed;
  graph["4"].inputs.steps = body.steps ?? 20;
  graph["4"].inputs.cfg = body.cfg ?? 2.5;
  graph["6"].inputs.frame_rate = fps;

  return graph;
}

export const VIDEO_UI_LIMITS = {
  maxDurationSec: 4,
  maxWidth: 576,
  maxHeight: 576,
  maxFps: 12,
  note: "Limity dopasowane do ~16 GB VRAM (RTX 5080). Wymaga SVD + VHS. Wrzuć obraz startowy powyżej promptu (upload do Comfy input) albo podaj istniejącą nazwę pliku.",
} as const;
