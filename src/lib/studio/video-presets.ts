/**
 * Presety jakości Wan (panel Wideo): Fast / Smooth 24 / Quality 720p / Quality 24 native.
 */
import {
  DEFAULT_WAN_UNET,
  DEFAULT_WAN_UNET_720P,
  WAN_UI_LIMITS,
} from "./video-engines";

export type WanQualityPresetId =
  | "fast-480p"
  | "smooth-24"
  | "quality-720p"
  | "quality-24-native";

export type WanQualityPreset = {
  id: WanQualityPresetId;
  label: string;
  blurb: string;
  width: number;
  height: number;
  /** FPS generacji w samplerze (chunk plan). */
  fps: number;
  steps: number;
  faceRestore: boolean;
  /** CodeFormer: niżej = mocniejszy restore (Quality). */
  faceRestoreFidelity: number;
  model: string;
  /** Gen @16 → Comfy RIFE → 24 (po stitch). */
  postRife: boolean;
  postUpscale: boolean;
};

export const WAN_QUALITY_PRESETS: WanQualityPreset[] = [
  {
    id: "fast-480p",
    label: "Fast 480p",
    blurb: "832×480 · 16 fps · steps ~12 · SAFE 81",
    width: WAN_UI_LIMITS.defaultWidth,
    height: WAN_UI_LIMITS.defaultHeight,
    fps: 16,
    steps: 12,
    faceRestore: false,
    faceRestoreFidelity: 0.5,
    model: DEFAULT_WAN_UNET,
    postRife: false,
    postUpscale: false,
  },
  {
    id: "smooth-24",
    label: "Smooth 24",
    blurb: "jak Fast, potem RIFE 16→24 (Comfy)",
    width: WAN_UI_LIMITS.defaultWidth,
    height: WAN_UI_LIMITS.defaultHeight,
    fps: 16,
    steps: 12,
    faceRestore: false,
    faceRestoreFidelity: 0.5,
    model: DEFAULT_WAN_UNET,
    postRife: true,
    postUpscale: false,
  },
  {
    id: "quality-720p",
    label: "Quality 720p",
    blurb: "1280×720 FP8 · steps 18 · face↑ · 16 fps",
    width: WAN_UI_LIMITS.qualityWidth,
    height: WAN_UI_LIMITS.qualityHeight,
    fps: 16,
    steps: 18,
    faceRestore: true,
    faceRestoreFidelity: 0.35,
    model: DEFAULT_WAN_UNET_720P,
    postRife: false,
    postUpscale: false,
  },
  {
    id: "quality-24-native",
    label: "Quality 24 native",
    blurb: "24 fps w samplerze · auto chunki (~3× @10s)",
    width: WAN_UI_LIMITS.defaultWidth,
    height: WAN_UI_LIMITS.defaultHeight,
    fps: 24,
    steps: 18,
    faceRestore: true,
    faceRestoreFidelity: 0.35,
    model: DEFAULT_WAN_UNET,
    postRife: false,
    postUpscale: false,
  },
];

export function getWanQualityPreset(
  id: string | undefined
): WanQualityPreset | undefined {
  return WAN_QUALITY_PRESETS.find((p) => p.id === id);
}
