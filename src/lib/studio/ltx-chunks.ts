import {
  LTX_UI_LIMITS,
  effectiveDurationSec,
  snapLtxLength,
} from "./video-engines";

export const LTX_CHUNK_OVERLAP = 1;

export type LtxChunkSpec = {
  /** Indeks 0-based */
  index: number;
  /** LTXV length (8n+1), ≤ maxLength */
  length: number;
  /** Unikalne klatki po stitch (chunk0 = length, kolejne = length − overlap) */
  uniqueFrames: number;
};

export type LtxChunkPlan = {
  chunks: LtxChunkSpec[];
  chunkCount: number;
  /** Suma unikalnych klatek po sklejeniu z overlap */
  totalUniqueFrames: number;
  effectiveDurationSec: number;
  fps: number;
  overlap: number;
  maxPerChunk: number;
  /** true gdy >1 chunk */
  chunked: boolean;
};

/**
 * Dzieli żądane klatki na odcinki ≤121 (8n+1) z overlap 1 (jak Legion smoke).
 * Stitch: chunk0 pełny + z każdego następnego od klatki 1 → unikalne ≈ sum(unique).
 */
export function planLtxChunks(
  requestedFrames: number,
  fps: number,
  options?: { maxPerChunk?: number; overlap?: number }
): LtxChunkPlan {
  const maxPerChunk = options?.maxPerChunk ?? LTX_UI_LIMITS.maxLength;
  const overlap = options?.overlap ?? LTX_CHUNK_OVERLAP;
  const target = Math.max(LTX_UI_LIMITS.minLength, Math.round(requestedFrames));

  if (target <= maxPerChunk) {
    const length = snapLtxLength(target);
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

  const chunks: LtxChunkSpec[] = [];
  let remaining = target;

  while (remaining > 0) {
    const isFirst = chunks.length === 0;
    let length: number;
    let unique: number;

    if (isFirst) {
      if (remaining <= maxPerChunk) {
        length = snapLtxLength(remaining);
        unique = length;
      } else {
        length = maxPerChunk; // 121
        unique = length;
      }
    } else {
      // Potrzebujemy `remaining` nowych klatek + 1 overlap na starcie
      const need = remaining + overlap;
      if (need <= maxPerChunk) {
        length = snapLtxLength(need);
        unique = Math.max(0, length - overlap);
      } else {
        length = maxPerChunk;
        unique = length - overlap;
      }
    }

    chunks.push({ index: chunks.length, length, uniqueFrames: unique });
    remaining -= unique;

    // Bezpiecznik
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
