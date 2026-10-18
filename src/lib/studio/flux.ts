/**
 * Flux.2 Dev (fp8 mixed) — domyślny silnik obrazu w Studio.
 * Pliki wg internal/flux-setup.md (Legion / Comfy-Org/flux2-dev).
 */

export const IMAGE_ENGINE_FLUX = "flux" as const;
export const IMAGE_ENGINE_SDXL = "sdxl" as const;

export type ImageEngine = typeof IMAGE_ENGINE_FLUX | typeof IMAGE_ENGINE_SDXL;

/** Wartość dropdownu / model id dla Flux (nie jest to pojedynczy checkpoint). */
export const FLUX_MODEL_ID = "flux";

/** UNET — diffusion_models/ */
export const DEFAULT_FLUX_UNET = "flux2_dev_fp8mixed.safetensors";
/** CLIP / text encoder FP8 (NIE bf16) — text_encoders/ */
export const DEFAULT_FLUX_CLIP = "mistral_3_small_flux2_fp8.safetensors";
/** VAE — vae/ */
export const DEFAULT_FLUX_VAE = "flux2-vae.safetensors";
export const DEFAULT_FLUX_WEIGHT_DTYPE = "default";
export const DEFAULT_FLUX_CLIP_TYPE = "flux2";

/** Kroki / guidance z blueprintu Flux.2 Dev (turbo LoRA wyłączone). */
export const DEFAULT_FLUX_STEPS = 20;
export const DEFAULT_FLUX_GUIDANCE = 4;

export const FLUX_UI_NOTE =
  "Flux.2 generuje dłużej niż SDXL (Dynamic VRAM na ~16 GB) — dłuższy czas jest OK dla jakości.";

/**
 * Flux (~33+17+0.3 GB) + Wan (~16+6+…) ≳ 73 GB wag vs ~64 GB RAM Legion —
 * przełączanie Obraz↔Wideo w serii = thrash / reload z dysku.
 */
export const FLUX_WAN_RAM_THRASH_TIP =
  "Tip RAM (~64 GB): Flux + Wan łącznie ~73 GB wag — nie przełączaj Obraz (Flux) ↔ Wideo (Wan) między jobami. Odpalaj wideo w serii (albo zrestartuj Comfy przed zmianą silnika).";

function trimOrUndefined(value: string | undefined): string | undefined {
  const t = value?.trim();
  return t ? t : undefined;
}

export function getFluxUnetName(): string {
  return (
    trimOrUndefined(process.env.STUDIO_FLUX_UNET) ?? DEFAULT_FLUX_UNET
  );
}

export function getFluxClipName(): string {
  return (
    trimOrUndefined(process.env.STUDIO_FLUX_CLIP) ?? DEFAULT_FLUX_CLIP
  );
}

export function getFluxVaeName(): string {
  return trimOrUndefined(process.env.STUDIO_FLUX_VAE) ?? DEFAULT_FLUX_VAE;
}

export function getFluxWeightDtype(): string {
  return (
    trimOrUndefined(process.env.STUDIO_FLUX_WEIGHT_DTYPE) ??
    DEFAULT_FLUX_WEIGHT_DTYPE
  );
}

/** Czy wybór modelu w UI / API wskazuje na workflow Flux. */
export function isFluxModel(model: string | undefined | null): boolean {
  const m = model?.trim().toLowerCase() ?? "";
  if (!m || m === FLUX_MODEL_ID) return true;
  if (m.includes("flux")) return true;
  const unet = getFluxUnetName().toLowerCase();
  return m === unet;
}

export function resolveImageEngine(
  model: string | undefined | null
): ImageEngine {
  return isFluxModel(model) ? IMAGE_ENGINE_FLUX : IMAGE_ENGINE_SDXL;
}

export type ImageModelOption = {
  value: string;
  label: string;
  engine: ImageEngine;
};

/** Opcje dropdownu Obraz: Flux pierwszy, potem SDXL i inne checkpointy. */
export function buildImageModelOptions(
  sdxlDefault: string,
  checkpoints: string[]
): ImageModelOption[] {
  const options: ImageModelOption[] = [
    {
      value: FLUX_MODEL_ID,
      label: `Flux.2 Dev (fp8) — ${getFluxUnetName()}`,
      engine: IMAGE_ENGINE_FLUX,
    },
    {
      value: sdxlDefault,
      label: `SDXL — ${sdxlDefault}`,
      engine: IMAGE_ENGINE_SDXL,
    },
  ];

  const seen = new Set(options.map((o) => o.value));
  for (const ckpt of checkpoints) {
    if (seen.has(ckpt)) continue;
    if (ckpt.toLowerCase().includes("flux")) continue;
    if (ckpt.toLowerCase().includes("svd")) continue;
    seen.add(ckpt);
    options.push({
      value: ckpt,
      label: ckpt,
      engine: IMAGE_ENGINE_SDXL,
    });
  }

  return options;
}
