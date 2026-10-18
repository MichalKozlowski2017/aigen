/**
 * Wan Fast — opcjonalny Patch Sage Attention KJ (ComfyUI-KJNodes).
 * Preferowane vs CLI `--use-sage-attention` (ryzyko black frames na Wan).
 * Graceful skip gdy node / KJNodes brak.
 */
import { comfyHasNodeClass } from "./comfy-client";

/** Typ w object_info (literówka Pathch w KJNodes — zachować). */
export const WAN_SAGE_NODE_CLASS = "PathchSageAttentionKJ";

/** CUDA int8/fp16 — stabilniejsze na sm120 niż globalny CLI / triton. */
export const WAN_SAGE_ATTENTION_MODE = "sageattn_qk_int8_pv_fp16_cuda";

export type WanSageResolve = {
  available: boolean;
  warning: string | null;
};

/** Sprawdza `/object_info/PathchSageAttentionKJ` — false gdy offline / brak KJNodes. */
export async function resolveWanSageAttentionNode(): Promise<WanSageResolve> {
  try {
    const available = await comfyHasNodeClass(WAN_SAGE_NODE_CLASS);
    if (available) {
      return { available: true, warning: null };
    }
    return {
      available: false,
      warning:
        "Brak PathchSageAttentionKJ (KJNodes) — Wan Fast bez Patch Sage Attention.",
    };
  } catch {
    return {
      available: false,
      warning:
        "Nie udało się odpytać Comfy object_info — Wan Fast bez Patch Sage Attention.",
    };
  }
}
