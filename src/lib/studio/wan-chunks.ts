import {
  WAN_UI_LIMITS,
  effectiveDurationSec,
  snapWanLength,
} from "./video-engines";
import type { LtxChunkPlan, LtxChunkSpec } from "./ltx-chunks";

export const WAN_CHUNK_OVERLAP = 1;

export type WanChunkPlan = LtxChunkPlan;
export type WanChunkSpec = LtxChunkSpec;

/**
 * Dzieli żądane klatki Wan na odcinki ≤ SAFE max (4n+1, default 81)
 * z overlap 1 — ten sam wzorzec stitch co LTX / Legion CHUNK_SMOKE.
 */
export function planWanChunks(
  requestedFrames: number,
  fps: number,
  options?: { maxPerChunk?: number; overlap?: number }
): WanChunkPlan {
  const maxPerChunk = options?.maxPerChunk ?? WAN_UI_LIMITS.maxLength;
  const overlap = options?.overlap ?? WAN_CHUNK_OVERLAP;
  const target = Math.max(WAN_UI_LIMITS.minLength, Math.round(requestedFrames));

  if (target <= maxPerChunk) {
    const length = snapWanLength(target);
    return {
      chunks: [{ index: 0, length, uniqueFrames: length }],
      chunkCount: 1,
      totalUniqueFrames: length,
      effectiveDurationSec: effectiveDurationSec(length, fps),
      fps,
      overlap,
      maxPerChunk,
      chunked: false,
    };
  }

  const chunks: WanChunkSpec[] = [];
  let remaining = target;

  while (remaining > 0) {
    const isFirst = chunks.length === 0;
    let length: number;
    let unique: number;

    if (isFirst) {
      if (remaining <= maxPerChunk) {
        length = snapWanLength(remaining);
        unique = length;
      } else {
        length = maxPerChunk;
        unique = length;
      }
    } else {
      const need = remaining + overlap;
      if (need <= maxPerChunk) {
        length = snapWanLength(need);
        unique = Math.max(0, length - overlap);
      } else {
        length = maxPerChunk;
        unique = length - overlap;
      }
    }

    chunks.push({ index: chunks.length, length, uniqueFrames: unique });
    remaining -= unique;
    if (chunks.length > 64) break;
  }

  const totalUniqueFrames = chunks.reduce((s, c) => s + c.uniqueFrames, 0);
  return {
    chunks,
    chunkCount: chunks.length,
    totalUniqueFrames,
    effectiveDurationSec: effectiveDurationSec(totalUniqueFrames, fps),
    fps,
    overlap,
    maxPerChunk,
    chunked: chunks.length > 1,
  };
}
