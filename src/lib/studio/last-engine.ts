/**
 * Ostatnia rodzina silnika (Obraz vs Wideo) — localStorage.
 * Przy zmianie Flux/SDXL ↔ Wan/LTX/SVD Studio woła Comfy /free przed jobem.
 */

export const LAST_ENGINE_FAMILY_KEY = "aigen.lastEngineFamily";

export type EngineFamily = "image" | "video";

export function parseEngineFamily(raw: string | null | undefined): EngineFamily | null {
  if (raw === "image" || raw === "video") return raw;
  return null;
}

export function readLastEngineFamily(): EngineFamily | null {
  if (typeof window === "undefined") return null;
  try {
    return parseEngineFamily(window.localStorage.getItem(LAST_ENGINE_FAMILY_KEY));
  } catch {
    return null;
  }
}

export function writeLastEngineFamily(family: EngineFamily): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_ENGINE_FAMILY_KEY, family);
  } catch {
    /* private mode / quota */
  }
}

/** true gdy trzeba soft-unload przed jobem (zmiana Obraz↔Wideo). */
export function shouldFreeBeforeJob(next: EngineFamily): boolean {
  const last = readLastEngineFamily();
  return last != null && last !== next;
}
