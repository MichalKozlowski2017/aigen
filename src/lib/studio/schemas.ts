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
  cfg: z.number().min(1).max(20).optional(),
  /** Sekundy klipu — tylko video */
  durationSec: z.number().min(1).max(8).optional(),
  fps: z.number().int().min(8).max(24).optional(),
  /** Opcjonalna ścieżka obrazu startowego (i2v) — nazwa w input Comfy */
  startImage: z.string().max(500).optional(),
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
