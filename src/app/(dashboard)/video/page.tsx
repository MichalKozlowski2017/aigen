import { GenerateForm } from "@/components/studio/generate-form";
import { getStudioPublicConfig } from "@/lib/studio/config";
import {
  listInstalledCheckpoints,
  listInstalledDiffusionModels,
} from "@/lib/studio/models";
import {
  DEFAULT_LTX_CHECKPOINT,
  DEFAULT_VIDEO_ENGINE,
  DEFAULT_WAN_UNET,
  LTX_UI_LIMITS,
  SVD_UI_LIMITS,
  WAN_UI_LIMITS,
} from "@/lib/studio/workflow-builder";

export const dynamic = "force-dynamic";

export default async function StudioVideoPage() {
  const [checkpoints, diffusionModels] = await Promise.all([
    listInstalledCheckpoints(),
    listInstalledDiffusionModels(),
  ]);
  const { comfyUrl } = getStudioPublicConfig();
  const hasWan = diffusionModels.some((c) => c.toLowerCase().includes("wan"));
  const hasLtx = checkpoints.some((c) => c.toLowerCase().includes("ltx"));
  const hasSvd = checkpoints.some((c) => c.toLowerCase().includes("svd"));
  const defaultModel =
    DEFAULT_VIDEO_ENGINE === "wan"
      ? diffusionModels.find((c) =>
          c.toLowerCase().includes("wan2.1_i2v_480p")
        ) ??
        diffusionModels.find((c) => c.toLowerCase().includes("wan")) ??
        DEFAULT_WAN_UNET
      : DEFAULT_VIDEO_ENGINE === "ltx"
        ? checkpoints.find((c) => c.toLowerCase().includes("ltx")) ??
          DEFAULT_LTX_CHECKPOINT
        : checkpoints.find((c) => c.toLowerCase().includes("svd")) ??
          "svd_xt.safetensors";

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-amber-200/70">
          Wideo
        </p>
        <h1
          className="text-3xl font-semibold tracking-tight text-stone-50 sm:text-4xl"
          style={{ fontFamily: "var(--font-studio-display), system-ui" }}
        >
          Obraz → wideo (Wan / LTX / SVD)
        </h1>
        <p className="max-w-2xl text-stone-400">
          Domyślnie{" "}
          <strong className="font-medium text-stone-300">Wan 2.1 I2V</strong>{" "}
          — domyślnie{" "}
          <strong className="font-medium text-stone-300">Fast 480p</strong>{" "}
          (832×480 · 16 fps). Quality 720p opcjonalnie (wolne). Smooth 24 =
          toggle RIFE, nie mandatory. FPS 16|24 · SAFE 81 · opcjonalny upscale.
          {!hasWan ? (
            <span className="text-amber-200/80">
              {" "}
              Brak Wan w <code className="text-amber-100/90">diffusion_models</code>{" "}
              — pobierz z zakładki Modele (FP8 480p/720p) albo użyj LTX.
            </span>
          ) : null}
          {hasWan && !hasLtx ? (
            <span className="text-stone-500">
              {" "}
              LTX draft niedostępny (brak wag).
            </span>
          ) : null}
          {hasLtx && !hasSvd ? (
            <span className="text-stone-500">
              {" "}
              SVD legacy niedostępny (brak wag).
            </span>
          ) : null}
        </p>
      </header>
      <GenerateForm
        defaultModel={defaultModel}
        checkpoints={[
          ...diffusionModels.filter((n) => n.toLowerCase().includes("wan")),
          ...checkpoints,
        ]}
        kind="video"
        videoLimitsNote={`Wan max ${WAN_UI_LIMITS.maxDurationSec}s / ${WAN_UI_LIMITS.maxWidth}×${WAN_UI_LIMITS.maxHeight} @ 16|24 FPS (SAFE ${WAN_UI_LIMITS.maxLength}) · LTX max ${LTX_UI_LIMITS.maxWidth}×${LTX_UI_LIMITS.maxHeight} · SVD max ${SVD_UI_LIMITS.maxDurationSec}s`}
        comfyUrl={comfyUrl}
      />
    </div>
  );
}
