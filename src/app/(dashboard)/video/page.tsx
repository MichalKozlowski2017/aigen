import { GenerateForm } from "@/components/studio/generate-form";
import { listInstalledCheckpoints } from "@/lib/studio/models";
import { VIDEO_UI_LIMITS } from "@/lib/studio/workflow-builder";

export const dynamic = "force-dynamic";

export default async function StudioVideoPage() {
  const checkpoints = await listInstalledCheckpoints();
  const defaultModel =
    checkpoints.find((c) => c.toLowerCase().includes("svd")) ??
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
          Tekst / obraz → wideo
        </h1>
        <p className="max-w-2xl text-stone-400">{VIDEO_UI_LIMITS.note}</p>
      </header>
      <GenerateForm
        defaultModel={defaultModel}
        checkpoints={checkpoints}
        kind="video"
        videoLimitsNote={`Max ${VIDEO_UI_LIMITS.maxDurationSec}s · ${VIDEO_UI_LIMITS.maxWidth}×${VIDEO_UI_LIMITS.maxHeight} · ${VIDEO_UI_LIMITS.maxFps} FPS`}
      />
    </div>
  );
}
