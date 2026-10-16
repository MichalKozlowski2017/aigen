import { GenerateForm } from "@/components/studio/generate-form";
import { listInstalledCheckpoints } from "@/lib/studio/models";
import {
  DEFAULT_LTX_CHECKPOINT,
  DEFAULT_VIDEO_ENGINE,
  LTX_UI_LIMITS,
  SVD_UI_LIMITS,
} from "@/lib/studio/workflow-builder";

export const dynamic = "force-dynamic";

export default async function StudioVideoPage() {
  const checkpoints = await listInstalledCheckpoints();
  const hasLtx = checkpoints.some((c) => c.toLowerCase().includes("ltx"));
  const hasSvd = checkpoints.some((c) => c.toLowerCase().includes("svd"));
  const defaultModel =
    DEFAULT_VIDEO_ENGINE === "ltx"
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
          Obraz → wideo (LTX / SVD)
        </h1>
        <p className="max-w-2xl text-stone-400">
          Domyślnie <strong className="font-medium text-stone-300">LTX</strong>{" "}
          (jakość, krótkie klipy). SVD zostaje jako szybki draft. Opcjonalnie Face
          restore (CodeFormer).
          {!hasLtx ? (
            <span className="text-amber-200/80">
              {" "}
              Brak checkpointu LTX na Legionie — pobierz z zakładki Modele albo
              użyj SVD.
            </span>
          ) : null}
          {hasLtx && !hasSvd ? (
            <span className="text-stone-500"> SVD draft niedostępny (brak wag).</span>
          ) : null}
        </p>
      </header>
      <GenerateForm
        defaultModel={defaultModel}
        checkpoints={checkpoints}
        kind="video"
        videoLimitsNote={`LTX max ${LTX_UI_LIMITS.maxDurationSec}s / ${LTX_UI_LIMITS.maxWidth}×${LTX_UI_LIMITS.maxHeight} · SVD max ${SVD_UI_LIMITS.maxDurationSec}s`}
      />
    </div>
  );
}
