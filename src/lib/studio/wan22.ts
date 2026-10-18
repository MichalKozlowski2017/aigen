/**
 * Wan 2.2 Fast — scaffold detection + graceful fallback to Wan 2.1.
 *
 * Legion (2026-10): WAN22 missing; WAN21 480+720 OK. Do NOT download multi-GB
 * on cloud VM — filenames below are for Legion install docs / future wiring.
 *
 * Full dual-noise MoE I2V (high+low) workflow is NOT wired yet — when files
 * appear, detect() reports ready and UI/API keep using 2.1 until a follow-up
 * wires the 2.2 graph.
 */
import { listComfyModelFolder } from "./comfy-client";

/** Comfy-Org / lightx2v — diffusion_models/ (FP8 ComfyUI-ready distill 4-step). */
export const WAN22_I2V_HIGH_NOISE_FP8 =
  "wan2.2_i2v_A14b_high_noise_scaled_fp8_e4m3_lightx2v_4step_comfyui.safetensors";
export const WAN22_I2V_LOW_NOISE_FP8 =
  "wan2.2_i2v_A14b_low_noise_scaled_fp8_e4m3_lightx2v_4step_comfyui.safetensors";

/** Official Comfy-Org fp16 (non-distill) — larger; optional Legion. */
export const WAN22_I2V_HIGH_NOISE_FP16 =
  "wan2.2_i2v_high_noise_14B_fp16.safetensors";
export const WAN22_I2V_LOW_NOISE_FP16 =
  "wan2.2_i2v_low_noise_14B_fp16.safetensors";

/**
 * Comfy-Org repackaged lightx2v 4-step LoRAs (loras/) — alternative to
 * fused distill UNETs when using base Wan 2.2 high/low UNETs.
 */
export const WAN22_LIGHTX2V_LORA_HIGH =
  "wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors";
export const WAN22_LIGHTX2V_LORA_LOW =
  "wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors";

/** HF repos for Legion download (not cloud VM). */
export const WAN22_HF_DISTILL =
  "https://huggingface.co/lightx2v/Wan2.2-Distill-Models";
export const WAN22_HF_COMFY_ORG =
  "https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged";

export type Wan22Detect = {
  /** true gdy high+low distill FP8 (lub fp16) widoczne w Comfy */
  available: boolean;
  /** true gdy LoRA 4-step high+low w loras/ */
  loraAvailable: boolean;
  highNoise: string | null;
  lowNoise: string | null;
  loraHigh: string | null;
  loraLow: string | null;
  /**
   * Studio nadal używa Wan 2.1 Fast — pełny graph 2.2 MoE nie jest jeszcze
   * podpięty. Gdy available=true, to sygnał do follow-up PR.
   */
  usingFallback21: true;
  note: string;
};

function basenameMatch(listed: string, want: string): boolean {
  const a = listed.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
  const b = want.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
  return a === b && a.length > 0;
}

function findAny(names: string[], candidates: string[]): string | null {
  for (const want of candidates) {
    const hit = names.find((n) => basenameMatch(n, want));
    if (hit) return hit;
  }
  // luźny match: nazwa zawiera wan2.2 + i2v + high/low
  return null;
}

function findLoose(
  names: string[],
  mustInclude: string[]
): string | null {
  const hit = names.find((n) => {
    const low = n.toLowerCase().replace(/\\/g, "/");
    return mustInclude.every((p) => low.includes(p));
  });
  return hit ?? null;
}

/**
 * Odpytuje Comfy `/models/diffusion_models` + `/models/loras`.
 * Graceful gdy offline / brak plików — always usingFallback21.
 */
export async function detectWan22Availability(): Promise<Wan22Detect> {
  const empty: Wan22Detect = {
    available: false,
    loraAvailable: false,
    highNoise: null,
    lowNoise: null,
    loraHigh: null,
    loraLow: null,
    usingFallback21: true,
    note: "Wan 2.2 nie wykryty — Fast path = Wan 2.1 + lightx2v 480p. Pobierz wagi na Legionie (nie na cloud VM).",
  };

  let diffusion: string[] = [];
  let loras: string[] = [];
  try {
    diffusion = await listComfyModelFolder("diffusion_models");
  } catch {
    return {
      ...empty,
      note: "Nie udało się odpytać Comfy diffusion_models — zostajemy przy Wan 2.1.",
    };
  }
  try {
    loras = await listComfyModelFolder("loras");
  } catch {
    loras = [];
  }

  const highNoise =
    findAny(diffusion, [WAN22_I2V_HIGH_NOISE_FP8, WAN22_I2V_HIGH_NOISE_FP16]) ??
    findLoose(diffusion, ["wan2.2", "i2v", "high"]);
  const lowNoise =
    findAny(diffusion, [WAN22_I2V_LOW_NOISE_FP8, WAN22_I2V_LOW_NOISE_FP16]) ??
    findLoose(diffusion, ["wan2.2", "i2v", "low"]);
  const loraHigh =
    findAny(loras, [WAN22_LIGHTX2V_LORA_HIGH]) ??
    findLoose(loras, ["wan2.2", "lightx2v", "high"]);
  const loraLow =
    findAny(loras, [WAN22_LIGHTX2V_LORA_LOW]) ??
    findLoose(loras, ["wan2.2", "lightx2v", "low"]);

  const available = Boolean(highNoise && lowNoise);
  const loraAvailable = Boolean(loraHigh && loraLow);

  if (!available) {
    return {
      ...empty,
      highNoise,
      lowNoise,
      loraHigh,
      loraLow,
      loraAvailable,
      note: highNoise || lowNoise
        ? "Wan 2.2 częściowo na dysku (brak pary high+low) — Fast = Wan 2.1. Dokończ download na Legionie."
        : empty.note,
    };
  }

  return {
    available: true,
    loraAvailable,
    highNoise,
    lowNoise,
    loraHigh,
    loraLow,
    usingFallback21: true,
    note:
      "Wan 2.2 high+low wykryte, ale Studio Fast nadal używa Wan 2.1 (scaffold). Follow-up: dual-noise MoE + lightx2v 4-step graph.",
  };
}
