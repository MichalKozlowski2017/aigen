/**
 * Wan Fast — lightx2v I2V 14B 480p CFG+step distill LoRA.
 * Nazwa zsynchronizowana z Legion download (internal/wan-lora-queue-legion.md).
 *
 * Gdy LoRA jest podłączona: CFG=1 i steps 4–8 są wymuszone (API/UI nie mogą
 * nadpisać np. cfg=6). Fast jest zawsze 480p — LoRA jest 480p distill.
 */
import { listComfyModelFolder } from "./comfy-client";
import {
  DEFAULT_WAN_UNET,
  WAN_UI_LIMITS,
} from "./video-engines";

/** Plik LoRA w Comfy `models/loras/` (Kijai / lightx2v). */
export const WAN_DISTILL_LORA_FILENAME =
  "lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors";

/** Steps Fast z LoRA (lightx2v: 4; twardy zakres 4–8). */
export const WAN_DISTILL_STEPS = 4;
export const WAN_DISTILL_STEPS_MIN = 4;
export const WAN_DISTILL_STEPS_MAX = 8;
export const WAN_DISTILL_CFG = 1;
export const WAN_DISTILL_SAMPLER = "euler";
export const WAN_DISTILL_SCHEDULER = "simple";
export const WAN_DISTILL_STRENGTH = 1;

/** Fallback gdy LoRA nie ma na Comfy — klasyczny Fast bez distill. */
export const WAN_FAST_NO_LORA_STEPS = 10;
export const WAN_FAST_NO_LORA_CFG = 6;
export const WAN_FAST_NO_LORA_SAMPLER = "uni_pc";
export const WAN_FAST_NO_LORA_SCHEDULER = "simple";

/** Geometria Fast / lightx2v 480p landscape (nie mieszać z UNET 720p). */
export const WAN_FAST_WIDTH = WAN_UI_LIMITS.defaultWidth;
export const WAN_FAST_HEIGHT = WAN_UI_LIMITS.defaultHeight;
/** Portrait Fast 480p — ta sama „krótka” krawędź 480. */
export const WAN_FAST_PORTRAIT_WIDTH = WAN_UI_LIMITS.defaultHeight;
export const WAN_FAST_PORTRAIT_HEIGHT = WAN_UI_LIMITS.defaultWidth;

/** Clamp steps gdy LoRA distill aktywna — zewnętrzne wartości nie wychodzą poza 4–8. */
export function clampWanDistillSteps(steps: number | undefined): number {
  const raw =
    typeof steps === "number" && Number.isFinite(steps)
      ? Math.round(steps)
      : WAN_DISTILL_STEPS;
  return Math.min(
    WAN_DISTILL_STEPS_MAX,
    Math.max(WAN_DISTILL_STEPS_MIN, raw)
  );
}

/**
 * Portrait gdy wysokość > szerokość (wymiary UI / start image).
 * Równe / landscape → false (domyślnie 832×480).
 */
export function isWanFastPortrait(options: {
  width?: number;
  height?: number;
}): boolean {
  const w = options.width ?? 0;
  const h = options.height ?? 0;
  if (w <= 0 || h <= 0) return false;
  return h > w;
}

/** true gdy rozdzielczość / model wygląda na Quality 720p (nie Fast 480×832). */
export function looksLikeWan720(options: {
  width?: number;
  height?: number;
  model?: string;
}): boolean {
  const w = options.width ?? 0;
  const h = options.height ?? 0;
  const shortSide = Math.min(w, h);
  const longSide = Math.max(w, h);
  // Fast 480p: 832×480 / 480×832 — short=480, long=832
  // Quality 720p: 1280×720 / 720×1280 — short≥640 lub long≥1024
  if (shortSide >= 640 || longSide >= 1024) return true;
  const m = (options.model ?? "").toLowerCase();
  return m.includes("720p") || m.includes("720_");
}

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

/** Fast preset (fast-480p / fast-upscale / smooth-24) chce distill gdy UI nie wyłączył. */
export function wantsWanDistill(qualityPreset: string | undefined): boolean {
  return (
    !qualityPreset ||
    qualityPreset === "fast-480p" ||
    qualityPreset === "fast-upscale" ||
    qualityPreset === "smooth-24"
  );
}

/**
 * Fast + distill LoRA = wyłącznie 480p (UNET 480p).
 * Zachowuje orientację: landscape 832×480, portrait 480×832
 * (z width/height UI albo wymiarów start image).
 * Coerce model; warning gdy API prosiło o 720p.
 */
export function coerceWanFast480pGeometry(options: {
  qualityPreset?: string;
  wanDistillLora?: boolean;
  width?: number;
  height?: number;
  model?: string;
}): {
  width: number;
  height: number;
  model: string;
  locked: boolean;
  portrait: boolean;
  warning: string | null;
} {
  const distillOn =
    options.wanDistillLora !== false &&
    (options.wanDistillLora === true || wantsWanDistill(options.qualityPreset));

  if (!distillOn) {
    return {
      width: options.width ?? WAN_FAST_WIDTH,
      height: options.height ?? WAN_FAST_HEIGHT,
      model: options.model?.trim() || DEFAULT_WAN_UNET,
      locked: false,
      portrait: isWanFastPortrait(options),
      warning: null,
    };
  }

  const portrait = isWanFastPortrait(options);
  const width = portrait ? WAN_FAST_PORTRAIT_WIDTH : WAN_FAST_WIDTH;
  const height = portrait ? WAN_FAST_PORTRAIT_HEIGHT : WAN_FAST_HEIGHT;
  const wanted720 = looksLikeWan720(options);
  const modelRaw = options.model?.trim() || "";
  const model =
    !modelRaw || modelRaw.toLowerCase().includes("720")
      ? DEFAULT_WAN_UNET
      : modelRaw;

  return {
    width,
    height,
    model,
    locked: true,
    portrait,
    warning: wanted720
      ? `Fast + lightx2v LoRA jest tylko 480p (${width}×${height}) — zignorowano 720p. Użyj presetu Quality 720p bez Fast LoRA.`
      : null,
  };
}
