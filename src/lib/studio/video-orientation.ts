/**
 * Orientacja wideo (Pion / Poziom / Auto).
 * Fast 480p: 480×832 vs 832×480 · Quality 720p: 720×1280 vs 1280×720.
 */
import { WAN_UI_LIMITS } from "./video-engines";
import {
  WAN_FAST_HEIGHT,
  WAN_FAST_PORTRAIT_HEIGHT,
  WAN_FAST_PORTRAIT_WIDTH,
  WAN_FAST_WIDTH,
} from "./wan-distill";

export type VideoOrientationMode = "auto" | "portrait" | "landscape";
export type VideoOrientationResolved = "portrait" | "landscape";

export const VIDEO_ORIENTATION_STORAGE_KEY = "aigen.videoOrientation";
export const VIDEO_ORIENTATION_LAST_KEY = "aigen.videoOrientationLast";

export const VIDEO_ORIENTATION_OPTIONS: {
  id: VideoOrientationMode;
  label: string;
  blurb: string;
}[] = [
  { id: "auto", label: "Auto", blurb: "z obrazu startowego" },
  { id: "portrait", label: "Pion", blurb: "9:16" },
  { id: "landscape", label: "Poziom", blurb: "16:9" },
];

export function parseVideoOrientationMode(
  raw: string | null | undefined
): VideoOrientationMode {
  if (raw === "portrait" || raw === "landscape" || raw === "auto") return raw;
  return "auto";
}

export function parseVideoOrientationResolved(
  raw: string | null | undefined
): VideoOrientationResolved | null {
  if (raw === "portrait" || raw === "landscape") return raw;
  return null;
}

/**
 * Auto: z wymiarów obrazu / canvas gdy dostępne, inaczej lastExplicit, inaczej poziom.
 * Pion / Poziom: wymuszone.
 */
export function resolveVideoOrientation(options: {
  mode: VideoOrientationMode;
  width?: number;
  height?: number;
  lastExplicit?: VideoOrientationResolved | null;
}): VideoOrientationResolved {
  if (options.mode === "portrait") return "portrait";
  if (options.mode === "landscape") return "landscape";
  const w = options.width ?? 0;
  const h = options.height ?? 0;
  if (w > 0 && h > 0) {
    return h > w ? "portrait" : "landscape";
  }
  return options.lastExplicit ?? "landscape";
}

export function wanFastSize(
  orientation: VideoOrientationResolved
): { width: number; height: number } {
  return orientation === "portrait"
    ? { width: WAN_FAST_PORTRAIT_WIDTH, height: WAN_FAST_PORTRAIT_HEIGHT }
    : { width: WAN_FAST_WIDTH, height: WAN_FAST_HEIGHT };
}

export function wanQuality720Size(
  orientation: VideoOrientationResolved
): { width: number; height: number } {
  return orientation === "portrait"
    ? {
        width: WAN_UI_LIMITS.qualityHeight,
        height: WAN_UI_LIMITS.qualityWidth,
      }
    : {
        width: WAN_UI_LIMITS.qualityWidth,
        height: WAN_UI_LIMITS.qualityHeight,
      };
}

/** Canonical size for Wan preset + resolved orientation. */
export function wanSizeForOrientation(
  qualityPreset: string | undefined,
  orientation: VideoOrientationResolved
): { width: number; height: number } {
  if (qualityPreset === "quality-720p") {
    return wanQuality720Size(orientation);
  }
  // Fast / Smooth / Fast+upscale / quality-24-native → 480p geometry
  return wanFastSize(orientation);
}

/**
 * Resolve orientation + snap to Fast 480p / Quality 720p pair.
 * Used by UI and API so Pion/Poziom force dims even if width/height disagree.
 */
export function applyWanOrientationSize(options: {
  orientation?: VideoOrientationMode;
  qualityPreset?: string;
  wanDistillLora?: boolean;
  width?: number;
  height?: number;
  lastExplicit?: VideoOrientationResolved | null;
}): {
  orientation: VideoOrientationResolved;
  width: number;
  height: number;
  portrait: boolean;
} {
  const mode = options.orientation ?? "auto";
  const orientation = resolveVideoOrientation({
    mode,
    width: options.width,
    height: options.height,
    lastExplicit: options.lastExplicit,
  });
  const size = wanSizeForOrientation(options.qualityPreset, orientation);
  return {
    orientation,
    width: size.width,
    height: size.height,
    portrait: orientation === "portrait",
  };
}
