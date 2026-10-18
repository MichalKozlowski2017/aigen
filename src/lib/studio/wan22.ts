/**
 * Wan 2.2 I2V Fast MoE — dual-noise (high + low) + lightx2v 4-step.
 *
 * Legion (2026-10-18): confirmed present:
 *   diffusion_models/wan2.2_i2v_{high,low}_noise_14B_fp8_scaled.safetensors
 *   loras/wan2.2_i2v_lightx2v_4steps_lora_v1_{high,low}_noise.safetensors
 *
 * Default Fast = Wan 2.1 + lightx2v. MoE is opt-in (WAN22_MOE_ENABLE=1) —
 * RTX 5080 / sm_120 hits cudaErrorNoKernelImageForDevice on low KSamplerAdvanced.
 *
 * Graph (when enabled): 2× UNETLoader → optional LoRA → optional Sage KJ →
 * ModelSamplingSD3(shift=5) → KSamplerAdvanced high (0→2) →
 * KSamplerAdvanced low (2→4) → VAEDecode. CFG=1, euler/simple, 4 steps.
 * Aligns with Comfy-Org video_wan2_2_14B_i2v + lightx2v 4-step NativeComfy.
 */
import { listComfyModelFolder } from "./comfy-client";

/**
 * Opt-in Wan 2.2 Fast MoE. Default false until MoE proven on sm_120.
 * Env: WAN22_MOE_ENABLE=1|true|yes
 */
export function isWan22FastMoeEnabled(): boolean {
  const v = process.env.WAN22_MOE_ENABLE?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** UI / pipeline note when MoE weights exist but MoE is disabled. */
export const WAN22_MOE_UNSTABLE_NOTE =
  "Wan 2.2 MoE chwilowo niestabilne na RTX 5080 — Fast = Wan 2.1 + lightx2v. Włącz MoE dopiero po fixie PyTorch/sm_120 (WAN22_MOE_ENABLE=1).";

/** Comfy-Org repackaged FP8 (Legion SoT) — base UNETs + separate lightx2v LoRAs. */
export const WAN22_I2V_HIGH_NOISE_FP8 =
  "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors";
export const WAN22_I2V_LOW_NOISE_FP8 =
  "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors";

/** Fused lightx2v 4-step distill FP8 (optional alternate — no LoRA needed). */
export const WAN22_I2V_HIGH_NOISE_FP8_FUSED =
  "wan2.2_i2v_A14b_high_noise_scaled_fp8_e4m3_lightx2v_4step_comfyui.safetensors";
export const WAN22_I2V_LOW_NOISE_FP8_FUSED =
  "wan2.2_i2v_A14b_low_noise_scaled_fp8_e4m3_lightx2v_4step_comfyui.safetensors";

/** Official Comfy-Org fp16 (non-distill) — larger; optional Legion. */
export const WAN22_I2V_HIGH_NOISE_FP16 =
  "wan2.2_i2v_high_noise_14B_fp16.safetensors";
export const WAN22_I2V_LOW_NOISE_FP16 =
  "wan2.2_i2v_low_noise_14B_fp16.safetensors";

/** Comfy-Org lightx2v 4-step LoRAs (loras/) — pair with base FP8 UNETs. */
export const WAN22_LIGHTX2V_LORA_HIGH =
  "wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors";
export const WAN22_LIGHTX2V_LORA_LOW =
  "wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors";

/** HF repos for Legion download (not cloud VM). */
export const WAN22_HF_DISTILL =
  "https://huggingface.co/lightx2v/Wan2.2-Distill-Models";
export const WAN22_HF_COMFY_ORG =
  "https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged";

/** Distill lock — lightx2v 4-step MoE (high 2 + low 2). */
export const WAN22_FAST_STEPS = 4;
export const WAN22_FAST_CFG = 1;
export const WAN22_FAST_SAMPLER = "euler";
export const WAN22_FAST_SCHEDULER = "simple";
export const WAN22_FAST_SHIFT = 5;
export const WAN22_FAST_LORA_STRENGTH = 1;
/** High-noise stage: steps 0 → split (of total 4). */
export const WAN22_FAST_HIGH_END_STEP = 2;
/**
 * Low-noise stage end (lightx2v NativeComfy: start=2, end=4 of steps=4).
 * Prefer total steps over the old “100 = finish” hack — same effective
 * range when steps=4, clearer for Comfy validators / schedules.
 */
export const WAN22_FAST_LOW_END_STEP = WAN22_FAST_STEPS;

export type Wan22Detect = {
  /** true gdy high+low UNET widoczne w Comfy */
  available: boolean;
  /** true gdy LoRA 4-step high+low w loras/ */
  loraAvailable: boolean;
  /**
   * true gdy Fast MoE może iść (high+low + LoRA pair, albo fused distill UNETs).
   * Studio Fast preferuje ten path; false → Wan 2.1.
   */
  fastMoeReady: boolean;
  /** fused lightx2v distill UNETs (bez osobnych LoRA) */
  fusedDistill: boolean;
  highNoise: string | null;
  lowNoise: string | null;
  loraHigh: string | null;
  loraLow: string | null;
  /** true gdy Studio ma użyć Wan 2.1 Fast zamiast MoE */
  usingFallback21: boolean;
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

/** Fused distill UNET names contain lightx2v / 4step. */
export function isWan22FusedDistillUnet(name: string | null): boolean {
  if (!name) return false;
  const low = name.toLowerCase();
  return (
    low.includes("lightx2v") ||
    low.includes("4step") ||
    low.includes("4_step")
  );
}

/**
 * Odpytuje Comfy `/models/diffusion_models` + `/models/loras`.
 * Graceful gdy offline / brak plików — usingFallback21.
 */
export async function detectWan22Availability(): Promise<Wan22Detect> {
  const empty: Wan22Detect = {
    available: false,
    loraAvailable: false,
    fastMoeReady: false,
    fusedDistill: false,
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
    findAny(diffusion, [
      WAN22_I2V_HIGH_NOISE_FP8,
      WAN22_I2V_HIGH_NOISE_FP8_FUSED,
      WAN22_I2V_HIGH_NOISE_FP16,
    ]) ?? findLoose(diffusion, ["wan2.2", "i2v", "high"]);
  const lowNoise =
    findAny(diffusion, [
      WAN22_I2V_LOW_NOISE_FP8,
      WAN22_I2V_LOW_NOISE_FP8_FUSED,
      WAN22_I2V_LOW_NOISE_FP16,
    ]) ?? findLoose(diffusion, ["wan2.2", "i2v", "low"]);
  const loraHigh =
    findAny(loras, [WAN22_LIGHTX2V_LORA_HIGH]) ??
    findLoose(loras, ["wan2.2", "lightx2v", "high"]);
  const loraLow =
    findAny(loras, [WAN22_LIGHTX2V_LORA_LOW]) ??
    findLoose(loras, ["wan2.2", "lightx2v", "low"]);

  const available = Boolean(highNoise && lowNoise);
  const loraAvailable = Boolean(loraHigh && loraLow);
  const fusedDistill =
    available &&
    isWan22FusedDistillUnet(highNoise) &&
    isWan22FusedDistillUnet(lowNoise);
  const fastMoeReady = available && (loraAvailable || fusedDistill);

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

  if (!fastMoeReady) {
    return {
      available: true,
      loraAvailable,
      fastMoeReady: false,
      fusedDistill: false,
      highNoise,
      lowNoise,
      loraHigh,
      loraLow,
      usingFallback21: true,
      note:
        "Wan 2.2 high+low wykryte, ale brak lightx2v LoRA pary (i nie fused distill) — Fast = Wan 2.1. Dołóż LoRA high+low na Legionie.",
    };
  }

  return {
    available: true,
    loraAvailable,
    fastMoeReady: true,
    fusedDistill,
    highNoise,
    lowNoise,
    loraHigh: fusedDistill && !loraAvailable ? null : loraHigh,
    loraLow: fusedDistill && !loraAvailable ? null : loraLow,
    usingFallback21: false,
    note: fusedDistill
      ? "Wan 2.2 Fast MoE (fused lightx2v distill UNETs) — high+low, 4-step (0→2/2→4), CFG=1, euler, shift=5."
      : "Wan 2.2 Fast MoE (FP8 + lightx2v LoRA) — high+low, 4-step (0→2/2→4), CFG=1, euler, shift=5.",
  };
}
