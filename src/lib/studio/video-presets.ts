/**
 * Presety jakości Wan (panel Wideo).
 * Domyślny: Fast 480p = lightx2v distill LoRA (steps 4–8, CFG=1, euler).
 * Fast zawsze 480p — nie mieszać z UNET 720p.
 * Smooth 24 = opcjonalny toggle RIFE (preferowany 24 fps vs Native 24).
 * Quality = bez LoRA / więcej steps. Native 24 = experimental.
 */
import {
  DEFAULT_WAN_UNET,
  DEFAULT_WAN_UNET_720P,
  WAN_UI_LIMITS,
} from "./video-engines";
import {
  WAN_DISTILL_CFG,
  WAN_DISTILL_SAMPLER,
  WAN_DISTILL_SCHEDULER,
  WAN_DISTILL_STEPS,
} from "./wan-distill";

export type WanQualityPresetId =
  | "fast-480p"
  | "fast-upscale"
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
  cfg: number;
  samplerName: string;
  scheduler: string;
  /** Podłącz lightx2v LoraLoaderModelOnly gdy plik jest na Comfy. */
  useDistillLora: boolean;
  faceRestore: boolean;
  /** CodeFormer: niżej = mocniejszy restore (Quality). */
  faceRestoreFidelity: number;
  model: string;
  /** Gen @16 → Comfy RIFE → 24 (po stitch). Tylko legacy id smooth-24. */
  postRife: boolean;
  postUpscale: boolean;
  /** Native 24 fps w samplerze — experimental, nie preferowane vs Smooth 24. */
  experimental?: boolean;
  /** false = tylko API/legacy; nie pokazuj w siatce presetów */
  showInUi?: boolean;
};

/** Domyślny preset panelu — Fast 480p + distill LoRA. */
export const DEFAULT_WAN_QUALITY_PRESET: WanQualityPresetId = "fast-480p";

/** Steps Fast z LoRA distill (domyślnie 4; twardy zakres 4–8 w builderze). */
export const DEFAULT_WAN_FAST_STEPS = WAN_DISTILL_STEPS;

export const WAN_QUALITY_PRESETS: WanQualityPreset[] = [
  {
    id: "fast-480p",
    label: "Fast 480p",
    blurb: "domyślny · distill LoRA · 832×480 / 480×832 · 16 fps · steps 4–8 · CFG 1 · euler",
    width: WAN_UI_LIMITS.defaultWidth,
    height: WAN_UI_LIMITS.defaultHeight,
    fps: 16,
    steps: WAN_DISTILL_STEPS,
    cfg: WAN_DISTILL_CFG,
    samplerName: WAN_DISTILL_SAMPLER,
    scheduler: WAN_DISTILL_SCHEDULER,
    useDistillLora: true,
    faceRestore: false,
    faceRestoreFidelity: 0.5,
    model: DEFAULT_WAN_UNET,
    postRife: false,
    postUpscale: false,
    showInUi: true,
  },
  {
    id: "fast-upscale",
    label: "Fast + upscale/smooth",
    blurb:
      "zalecane vs Quality 720p · 480p + RealESRGAN×2 + RIFE 16→24 · szybciej niż native 720p",
    width: WAN_UI_LIMITS.defaultWidth,
    height: WAN_UI_LIMITS.defaultHeight,
    fps: 16,
    steps: WAN_DISTILL_STEPS,
    cfg: WAN_DISTILL_CFG,
    samplerName: WAN_DISTILL_SAMPLER,
    scheduler: WAN_DISTILL_SCHEDULER,
    useDistillLora: true,
    faceRestore: false,
    faceRestoreFidelity: 0.5,
    model: DEFAULT_WAN_UNET,
    postRife: true,
    postUpscale: true,
    showInUi: true,
  },
  {
    id: "smooth-24",
    label: "Smooth 24",
    blurb: "legacy — użyj Fast + upscale/smooth albo toggle RIFE",
    width: WAN_UI_LIMITS.defaultWidth,
    height: WAN_UI_LIMITS.defaultHeight,
    fps: 16,
    steps: WAN_DISTILL_STEPS,
    cfg: WAN_DISTILL_CFG,
    samplerName: WAN_DISTILL_SAMPLER,
    scheduler: WAN_DISTILL_SCHEDULER,
    useDistillLora: true,
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
    blurb:
      "WOLNE (~40+ min/chunk @16GB) · bez LoRA · 1280×720 · preferuj Fast + upscale/smooth",
    width: WAN_UI_LIMITS.qualityWidth,
    height: WAN_UI_LIMITS.qualityHeight,
    fps: 16,
    steps: 18,
    cfg: 6,
    samplerName: "uni_pc",
    scheduler: "simple",
    useDistillLora: false,
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
    blurb: "experimental · 24 fps w samplerze · preferuj Fast + RIFE",
    width: WAN_UI_LIMITS.defaultWidth,
    height: WAN_UI_LIMITS.defaultHeight,
    fps: 24,
    steps: 18,
    cfg: 6,
    samplerName: "uni_pc",
    scheduler: "simple",
    useDistillLora: false,
    faceRestore: true,
    faceRestoreFidelity: 0.35,
    model: DEFAULT_WAN_UNET,
    postRife: false,
    postUpscale: false,
    experimental: true,
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
