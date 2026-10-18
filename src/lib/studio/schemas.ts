import { z } from "zod";

export const generateBodySchema = z.object({
  kind: z.enum(["image", "video"]).default("image"),
  prompt: z.string().min(1).max(4000),
  negativePrompt: z.string().max(4000).optional().default(""),
  model: z.string().min(1).max(260).optional(),
  width: z.number().int().min(256).max(2048).optional(),
  height: z.number().int().min(256).max(2048).optional(),
  seed: z.number().int().min(-1).max(2_147_483_647).optional(),
  batch: z.number().int().min(1).max(4).optional().default(1),
  steps: z.number().int().min(1).max(60).optional(),
  cfg: z.number().min(1).max(30).optional(),
  /** Sekundy klipu — tylko video (UI do 60s; SVD/VRAM może nie uciągnąć) */
  durationSec: z.number().min(1).max(60).optional(),
  fps: z.number().int().min(1).max(30).optional(),
  /** Nazwa pliku w ComfyUI input (po uploadzie lub już obecna) */
  startImage: z.string().max(500).optional(),
  /** Dokładna lokalizacja z galerii Comfy (/view) — unikamy zgadywania subfolderów */
  startImageSource: z
    .object({
      filename: z.string().min(1).max(500),
      subfolder: z.string().max(500).optional().default(""),
      type: z.string().max(40).optional().default("output"),
    })
    .optional(),
  /** Silnik wideo: wan (jakość) | ltx (draft) | svd (legacy) */
  videoEngine: z.enum(["wan", "ltx", "svd"]).optional(),
  /** CodeFormer (facerestore_cf) na klatkach przed VHS — per chunk */
  faceRestore: z.boolean().optional().default(false),
  /** CodeFormer fidelity 0–1 (niżej = mocniejszy restore) */
  faceRestoreFidelity: z.number().min(0).max(1).optional(),
  /** Preset Wan: fast-480p | fast-upscale | smooth-24 | quality-720p | quality-24-native */
  qualityPreset: z
    .enum([
      "fast-480p",
      "fast-upscale",
      "smooth-24",
      "quality-720p",
      "quality-24-native",
    ])
    .optional(),
  /**
   * Fast: lightx2v distill LoRA (LoraLoaderModelOnly) gdy plik na Comfy.
   * false = Quality / wymuś bez LoRA. true = wymuś próbę. undefined = z presetu.
   * Gdy LoRA aktywna: serwer wymusza CFG=1, steps 4–8 i geometrię 480p
   * (API cfg=6 / 720p nie nadpisze).
   */
  wanDistillLora: z.boolean().optional(),
  /** Po stitch: Comfy RIFE 16→24 (graceful jeśli node brak) */
  postRife: z.boolean().optional().default(false),
  /** Po stitch: RealESRGAN / upscale 2× (graceful) */
  postUpscale: z.boolean().optional().default(false),
  /** Długość jednego chunka (Wan 4n+1 ≤81 / LTX 8n+1 ≤121) */
  ltxChunkLength: z.number().int().min(9).max(121).optional(),
  /**
   * Preferowany max klatek/chunk przy planowaniu (Wan).
   * Fast default 81; Quality720 65; smoke 33. UI opcja nie psuje short smoke.
   */
  maxPerChunk: z.number().int().min(17).max(81).optional(),
  /** Zapisz ostatnią klatkę (SaveImage) do kontynuacji chunków */
  ltxSaveTail: z.boolean().optional().default(false),
  /** Indeks chunka (prefix plików) */
  ltxChunkIndex: z.number().int().min(0).max(64).optional(),
});

export const stitchBodySchema = z.object({
  clips: z
    .array(
      z.object({
        filename: z.string().min(1).max(500),
        subfolder: z.string().max(500).optional().default(""),
        type: z.string().max(40).optional().default("output"),
      })
    )
    .min(2)
    .max(64),
  fps: z.number().int().min(1).max(60).default(24),
  /** Ile pierwszych klatek pominąć w clipach 2…N (overlap) */
  overlapFrames: z.number().int().min(0).max(8).default(1),
  filenamePrefix: z.string().max(120).optional().default("studio/video-ltx-stitched"),
});

export type GenerateBody = z.infer<typeof generateBodySchema>;

export const loginBodySchema = z.object({
  password: z.string().min(1).max(200),
});

export const downloadBodySchema = z.object({
  modelId: z.string().min(1).max(120),
});

export const galleryQuerySchema = z.object({
  kind: z.enum(["all", "image", "video"]).optional().default("all"),
  limit: z.coerce.number().int().min(1).max(200).optional().default(60),
});
