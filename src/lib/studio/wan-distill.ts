/**
 * Wan Fast — lightx2v I2V 14B 480p CFG+step distill LoRA.
 * Nazwa zsynchronizowana z Legion download (internal/wan-lora-queue-legion.md).
 */
import { listComfyModelFolder } from "./comfy-client";

/** Plik LoRA w Comfy `models/loras/` (Kijai / lightx2v). */
export const WAN_DISTILL_LORA_FILENAME =
  "lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors";

/** Steps Fast z LoRA (lightx2v: 4; dopuszczalne 4–6). */
export const WAN_DISTILL_STEPS = 4;
export const WAN_DISTILL_CFG = 1;
export const WAN_DISTILL_SAMPLER = "euler";
export const WAN_DISTILL_SCHEDULER = "simple";
export const WAN_DISTILL_STRENGTH = 1;

/** Fallback gdy LoRA nie ma na Comfy — klasyczny Fast bez distill. */
export const WAN_FAST_NO_LORA_STEPS = 10;
export const WAN_FAST_NO_LORA_CFG = 6;
export const WAN_FAST_NO_LORA_SAMPLER = "uni_pc";
export const WAN_FAST_NO_LORA_SCHEDULER = "simple";

export type WanDistillResolve = {
  /** true = podłącz LoraLoaderModelOnly */
  attach: boolean;
  loraName: string | null;
  warning: string | null;
};

function basenameMatch(listed: string, want: string): boolean {
  const a = listed.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
  const b = want.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
  return a === b && a.length > 0;
}

/**
 * Sprawdza Comfy `/models/loras` — graceful gdy offline / brak pliku.
 */
export async function resolveWanDistillLora(
  preferName: string = WAN_DISTILL_LORA_FILENAME
): Promise<WanDistillResolve> {
  try {
    const names = await listComfyModelFolder("loras");
    const hit = names.find((n) => basenameMatch(n, preferName));
    if (hit) {
      return { attach: true, loraName: hit, warning: null };
    }
    return {
      attach: false,
      loraName: null,
      warning: `Brak LoRA distill (${preferName}) w Comfy loras — Fast bez przyspieszenia lightx2v (steps ~${WAN_FAST_NO_LORA_STEPS}).`,
    };
  } catch {
    return {
      attach: false,
      loraName: null,
      warning:
        "Nie udało się odpytać Comfy /models/loras — Fast bez LoRA distill (graceful).",
    };
  }
}

/** Fast preset (fast-480p / smooth-24) chce distill gdy UI nie wyłączył. */
export function wantsWanDistill(qualityPreset: string | undefined): boolean {
  return (
    !qualityPreset ||
    qualityPreset === "fast-480p" ||
    qualityPreset === "smooth-24"
  );
}
