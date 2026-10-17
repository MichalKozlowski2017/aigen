/**
 * Presety jakości Wan (panel Wideo).
 * Domyślny: Fast 480p. Smooth 24 = opcjonalny toggle RIFE (nie osobny preset UI).
 * Quality 720p zostaje w UI, ale nie jest defaultem (za wolne na 16 GB).
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
  /** Gen @16 → Comfy RIFE → 24 (po stitch). Tylko legacy id smooth-24. */
  postRife: boolean;
  postUpscale: boolean;
  /** false = tylko API/legacy; nie pokazuj w siatce presetów */
  showInUi?: boolean;
};

/** Domyślny preset panelu — Fast 480p (A/B: Quality720 ~1.5h za długo). */
export const DEFAULT_WAN_QUALITY_PRESET: WanQualityPresetId = "fast-480p";

/** Steps Fast (10–12). */
export const DEFAULT_WAN_FAST_STEPS = 10;

export const WAN_QUALITY_PRESETS: WanQualityPreset[] = [
  {
    id: "fast-480p",
    label: "Fast 480p",
    blurb: "domyślny · 832×480 · 16 fps · steps ~10 · SAFE 81",
    width: WAN_UI_LIMITS.defaultWidth,
    height: WAN_UI_LIMITS.defaultHeight,
    fps: 16,
    steps: DEFAULT_WAN_FAST_STEPS,
    faceRestore: false,
    faceRestoreFidelity: 0.5,
    model: DEFAULT_WAN_UNET,
    postRife: false,
    postUpscale: false,
    showInUi: true,
  },
  {
    id: "smooth-24",
    label: "Smooth 24",
    blurb: "legacy — użyj toggle Post RIFE na Fast",
    width: WAN_UI_LIMITS.defaultWidth,
    height: WAN_UI_LIMITS.defaultHeight,
    fps: 16,
    steps: DEFAULT_WAN_FAST_STEPS,
    faceRestore: false,
    faceRestoreFidelity: 0.5,
    model: DEFAULT_WAN_UNET,
    postRife: true,
    postUpscale: false,
    showInUi: false,
  },
  {
    id: "quality-720p",
    label: "Quality 720p",
    blurb: "opcjonalnie · 1280×720 · steps 18 · wolne (~40+ min/chunk)",
    width: WAN_UI_LIMITS.qualityWidth,
    height: WAN_UI_LIMITS.qualityHeight,
    fps: 16,
    steps: 18,
    faceRestore: true,
    faceRestoreFidelity: 0.35,
    model: DEFAULT_WAN_UNET_720P,
    postRife: false,
    postUpscale: false,
    showInUi: true,
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
    showInUi: true,
  },
];

/** Presety widoczne w siatce UI (bez Smooth — to osobny toggle RIFE). */
export const WAN_QUALITY_PRESETS_UI = WAN_QUALITY_PRESETS.filter(
  (p) => p.showInUi !== false
);

export function getWanQualityPreset(
  id: string | undefined
): WanQualityPreset | undefined {
  return WAN_QUALITY_PRESETS.find((p) => p.id === id);
}
