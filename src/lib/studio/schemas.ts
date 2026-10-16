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
  /** Silnik wideo: ltx (jakość) | svd (draft) */
  videoEngine: z.enum(["ltx", "svd"]).optional(),
  /** CodeFormer (facerestore_cf) na klatkach przed VHS — per chunk */
  faceRestore: z.boolean().optional().default(false),
  /** Długość jednego chunka LTX (8n+1 ≤ 121) — gdy chunked pipeline */
  ltxChunkLength: z.number().int().min(9).max(121).optional(),
  /** Zapisz ostatnią klatkę (SaveImage) do kontynuacji */
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
