/**
 * Post-stitch Comfy: opcjonalny RIFE (16→24) i/lub RealESRGAN upscale.
 * Graceful — brak node'a / wag → warning + oryginalny klip.
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  enqueuePrompt,
  fetchComfyViewBlob,
  getJobStatus,
} from "./comfy-client";
import { getComfyUrlAsync } from "./config";
import type { MediaRef } from "./video-outputs";

export const DEFAULT_RIFE_CKPT = "rife47.pth";
export const DEFAULT_UPSCALE_MODEL = "RealESRGAN_x2plus.pth";

export type PostProcessOptions = {
  clip: MediaRef;
  /** FPS po stitch (np. 16). */
  sourceFps: number;
  postRife?: boolean;
  /** Docelowe FPS po RIFE (domyślnie 24). */
  targetFps?: number;
  postUpscale?: boolean;
  rifeCkpt?: string;
  upscaleModel?: string;
  filenamePrefix?: string;
  /** Max wait na jeden job Comfy (ms). */
  jobTimeoutMs?: number;
};

export type PostProcessResult = {
  clip: MediaRef;
  warnings: string[];
  rifeApplied: boolean;
  upscaleApplied: boolean;
};

function isMissingNodeError(err: unknown): boolean {
  const blob =
    err instanceof Error
      ? `${err.message} ${JSON.stringify(
          (err as Error & { nodeErrors?: unknown; comfyError?: unknown })
            .nodeErrors ?? ""
        )}`
      : String(err);
  return (
    /missing_node_type|not in list|not found|No module|RIFE VFI|UpscaleModelLoader|ImageUpscaleWithModel|VHS_LoadVideo/i.test(
      blob
    ) || /Value not in list/i.test(blob)
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function waitForComfyJob(
  promptId: string,
  timeoutMs: number
): Promise<{
  ok: boolean;
  outputs: MediaRef[];
  error?: string;
}> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await getJobStatus(promptId);
    if (job.status === "completed") {
      return { ok: true, outputs: job.outputs };
    }
    if (job.status === "failed") {
      return {
        ok: false,
        outputs: [],
        error: job.progress.errorMessage ?? "Job Comfy nieudany",
      };
    }
    await sleep(2_000);
  }
  return { ok: false, outputs: [], error: "Timeout oczekiwania na post-process" };
}

function pickMp4(outputs: MediaRef[]): MediaRef | null {
  const mp4 = outputs.find((o) => o.filename.toLowerCase().endsWith(".mp4"));
  return mp4 ?? outputs[0] ?? null;
}

/** Skopiuj klip z output do input (VHS_LoadVideo czyta input). */
async function ensureClipInInput(clip: MediaRef): Promise<string> {
  const blob = await fetchComfyViewBlob(
    clip.filename,
    clip.subfolder ?? "",
    clip.type ?? "output"
  );
  if (!blob) {
    throw new Error(`Nie pobrano klipu do post-process: ${clip.filename}`);
  }
  const base = clip.filename.includes("/")
    ? clip.filename.slice(clip.filename.lastIndexOf("/") + 1)
    : clip.filename;
  const inputName = `aigen-post-${Date.now()}-${base}`;
  const uploaded = await uploadVideoBuffer(
    Buffer.from(await blob.arrayBuffer()),
    inputName,
    "input",
    ""
  );
  return uploaded.name;
}

async function uploadVideoBuffer(
  data: Buffer,
  filename: string,
  type: string,
  subfolder: string
): Promise<{ name: string; subfolder: string; type: string }> {
  const form = new FormData();
  form.append(
    "image",
    new Blob([new Uint8Array(data)], { type: "video/mp4" }),
    filename
  );
  form.append("overwrite", "true");
  form.append("type", type);
  if (subfolder) form.append("subfolder", subfolder);

  const base = (await getComfyUrlAsync()).replace(/\/$/, "");
  const res = await fetch(`${base}/upload/image`, {
    method: "POST",
    body: form,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as {
    name?: string;
    subfolder?: string;
    type?: string;
  };
  if (!res.ok || !json.name) {
    throw new Error(`Upload mp4 (post) HTTP ${res.status}`);
  }
  return {
    name: json.name,
    subfolder: json.subfolder ?? subfolder,
    type: json.type ?? type,
  };
}

/**
 * RIFE VFI (ComfyUI-Frame-Interpolation): ×2 klatek, potem ffmpeg → targetFps
 * z zachowaniem czasu trwania (16→32→24).
 */
function buildRifeWorkflow(
  inputVideo: string,
  options: {
    rifeCkpt: string;
    combineFps: number;
    filenamePrefix: string;
  }
): Record<string, unknown> {
  return {
    "1": {
      class_type: "VHS_LoadVideo",
      inputs: {
        video: inputVideo,
        force_rate: 0,
        custom_width: 0,
        custom_height: 0,
        frame_load_cap: 0,
        skip_first_frames: 0,
        select_every_nth: 1,
      },
    },
    "2": {
      class_type: "RIFE VFI",
      inputs: {
        ckpt_name: options.rifeCkpt,
        frames: ["1", 0],
        clear_cache_after_n_frames: 10,
        multiplier: 2,
        fast_mode: true,
        ensemble: true,
        scale_factor: 1,
        // INPUT_TYPES defaults (Fannovel16 RIFE VFI): float32 / False / 1
        dtype: "float32",
        torch_compile: false,
        batch_size: 1,
      },
    },
    "3": {
      class_type: "VHS_VideoCombine",
      inputs: {
        images: ["2", 0],
        frame_rate: options.combineFps,
        loop_count: 0,
        filename_prefix: options.filenamePrefix,
        format: "video/h264-mp4",
        pingpong: false,
        save_output: true,
      },
    },
  };
}

function buildUpscaleWorkflow(
  inputVideo: string,
  options: {
    upscaleModel: string;
    frameRate: number;
    filenamePrefix: string;
  }
): Record<string, unknown> {
  return {
    "1": {
      class_type: "VHS_LoadVideo",
      inputs: {
        video: inputVideo,
        force_rate: 0,
        custom_width: 0,
        custom_height: 0,
        frame_load_cap: 0,
        skip_first_frames: 0,
        select_every_nth: 1,
      },
    },
    "2": {
      class_type: "UpscaleModelLoader",
      inputs: {
        model_name: options.upscaleModel,
      },
    },
    "3": {
      class_type: "ImageUpscaleWithModel",
      inputs: {
        upscale_model: ["2", 0],
        image: ["1", 0],
      },
    },
    "4": {
      class_type: "VHS_VideoCombine",
      inputs: {
        images: ["3", 0],
        frame_rate: options.frameRate,
        loop_count: 0,
        filename_prefix: options.filenamePrefix,
        format: "video/h264-mp4",
        pingpong: false,
        save_output: true,
      },
    },
  };
}

function resolveFfmpegBin(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const staticBin = require("ffmpeg-static") as string | null;
    if (staticBin) return staticBin;
  } catch {
    /* PATH */
  }
  return "ffmpeg";
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveFfmpegBin(), args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let err = "";
    child.stderr.on("data", (d: Buffer) => {
      err += d.toString();
    });
    child.on("error", (e) => reject(e));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${err.slice(-600)}`));
    });
  });
}

/** RIFE×2 @ 2·sourceFps → fps=target z zachowaniem duration. */
async function retimeToFps(
  clip: MediaRef,
  targetFps: number,
  filenamePrefix: string
): Promise<MediaRef> {
  const blob = await fetchComfyViewBlob(
    clip.filename,
    clip.subfolder ?? "",
    clip.type ?? "output"
  );
  if (!blob) throw new Error("Brak klipu do retime fps");

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "aigen-retime-"));
  try {
    const src = path.join(tmp, "in.mp4");
    const out = path.join(tmp, "out.mp4");
    await fs.writeFile(src, Buffer.from(await blob.arrayBuffer()));
    await runFfmpeg([
      "-y",
      "-i",
      src,
      "-filter:v",
      `fps=${targetFps}`,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-an",
      out,
    ]);
    const buf = await fs.readFile(out);
    const base = filenamePrefix.split("/").pop() || "video-rife24";
    const name = `${base}_${Date.now()}.mp4`;
    const uploaded = await uploadVideoBuffer(buf, name, "output", "studio");
    return {
      filename: uploaded.name,
      subfolder: uploaded.subfolder || "studio",
      type: uploaded.type || "output",
    };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Opcjonalny post po stitch. Nie rzuca przy braku RIFE/upscale — zwraca warnings.
 */
export async function runVideoPostProcess(
  options: PostProcessOptions
): Promise<PostProcessResult> {
  const warnings: string[] = [];
  let clip = options.clip;
  let rifeApplied = false;
  let upscaleApplied = false;
  const targetFps = options.targetFps ?? 24;
  const timeoutMs = options.jobTimeoutMs ?? 600_000;
  const prefix = options.filenamePrefix ?? "studio/video-post";

  if (!options.postRife && !options.postUpscale) {
    return { clip, warnings, rifeApplied, upscaleApplied };
  }

  let inputName: string;
  try {
    inputName = await ensureClipInInput(clip);
  } catch (err) {
    warnings.push(
      `Post-process: nie udało się przygotować klipu (${
        err instanceof Error ? err.message : String(err)
      }) — zostawiam stitch.`
    );
    return { clip, warnings, rifeApplied, upscaleApplied };
  }

  if (options.postRife) {
    const combineFps = Math.max(1, options.sourceFps * 2);
    try {
      const workflow = buildRifeWorkflow(inputName, {
        rifeCkpt: options.rifeCkpt ?? DEFAULT_RIFE_CKPT,
        combineFps,
        filenamePrefix: `${prefix}-rife`,
      });
      const { promptId } = await enqueuePrompt(workflow, "aigen-rife");
      const done = await waitForComfyJob(promptId, timeoutMs);
      if (!done.ok) {
        warnings.push(
          `RIFE pominięty: ${done.error ?? "job failed"}. Zostawiam ${options.sourceFps} fps.`
        );
      } else {
        const out = pickMp4(done.outputs);
        if (!out) {
          warnings.push("RIFE: brak mp4 w outputach — pomijam.");
        } else {
          try {
            clip = await retimeToFps(out, targetFps, `${prefix}-rife${targetFps}`);
            rifeApplied = true;
            // kolejny krok (upscale) czyta z input
            inputName = await ensureClipInInput(clip);
          } catch (retimeErr) {
            clip = out;
            rifeApplied = true;
            warnings.push(
              `RIFE OK, retime→${targetFps} nieudany (${
                retimeErr instanceof Error ? retimeErr.message : String(retimeErr)
              }) — zostawiam wyjście RIFE @ ${combineFps} fps.`
            );
            inputName = await ensureClipInInput(clip).catch(() => inputName);
          }
        }
      }
    } catch (err) {
      if (isMissingNodeError(err)) {
        warnings.push(
          "RIFE niedostępny na Legionie (brak ComfyUI-Frame-Interpolation / wag) — Smooth 24 bez interpolacji."
        );
      } else {
        warnings.push(
          `RIFE pominięty: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  if (options.postUpscale) {
    const fpsForCombine = rifeApplied ? targetFps : options.sourceFps;
    try {
      const workflow = buildUpscaleWorkflow(inputName, {
        upscaleModel: options.upscaleModel ?? DEFAULT_UPSCALE_MODEL,
        frameRate: fpsForCombine,
        filenamePrefix: `${prefix}-upscale`,
      });
      const { promptId } = await enqueuePrompt(workflow, "aigen-upscale");
      const done = await waitForComfyJob(promptId, timeoutMs);
      if (!done.ok) {
        warnings.push(`Upscale pominięty: ${done.error ?? "job failed"}.`);
      } else {
        const out = pickMp4(done.outputs);
        if (!out) {
          warnings.push("Upscale: brak mp4 — pomijam.");
        } else {
          clip = out;
          upscaleApplied = true;
        }
      }
    } catch (err) {
      if (isMissingNodeError(err)) {
        warnings.push(
          "Upscale niedostępny (brak UpscaleModelLoader / RealESRGAN) — bez 2×."
        );
      } else {
        warnings.push(
          `Upscale pominięty: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  return { clip, warnings, rifeApplied, upscaleApplied };
}
