/**
 * Wan Fast — opcjonalny Patch Sage Attention KJ (ComfyUI-KJNodes).
 *
 * Default OFF — PathchSageAttentionKJ triggers cudaErrorNoKernelImageForDevice
 * on RTX 5080 (sm_120). Legion confirmed: Wan 2.1 Fast WITHOUT Sage = SUCCESS;
 * MoE+Sage fails. Opt in with WAN_SAGE_ENABLE=1 after CUDA kernels work.
 */
import { comfyHasNodeClass } from "./comfy-client";

/** Typ w object_info (literówka Pathch w KJNodes — zachować). */
export const WAN_SAGE_NODE_CLASS = "PathchSageAttentionKJ";

/** CUDA int8/fp16 — tylko gdy WAN_SAGE_ENABLE=1. */
export const WAN_SAGE_ATTENTION_MODE = "sageattn_qk_int8_pv_fp16_cuda";

/**
 * Opt-in Sage KJ. Default false (RTX 5080 / sm_120 no-kernel).
 * Env: WAN_SAGE_ENABLE=1|true|yes
 */
export function isWanSageEnabled(): boolean {
  const v = process.env.WAN_SAGE_ENABLE?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export type WanSageResolve = {
  available: boolean;
  warning: string | null;
};

/**
 * true tylko gdy WAN_SAGE_ENABLE=1 AND node w object_info.
 * Default: skip splice (Wan Fast / MoE bez PathchSageAttentionKJ).
 */
export async function resolveWanSageAttentionNode(): Promise<WanSageResolve> {
  if (!isWanSageEnabled()) {
    return { available: false, warning: null };
  }
  try {
    const available = await comfyHasNodeClass(WAN_SAGE_NODE_CLASS);
    if (available) {
      return { available: true, warning: null };
    }
    return {
      available: false,
      warning:
        "WAN_SAGE_ENABLE=1, ale brak PathchSageAttentionKJ (KJNodes) — bez Sage.",
    };
  } catch {
    return {
      available: false,
      warning:
        "WAN_SAGE_ENABLE=1, ale object_info niedostępne — Wan bez Patch Sage Attention.",
    };
  }
}
