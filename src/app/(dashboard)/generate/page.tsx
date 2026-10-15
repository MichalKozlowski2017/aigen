import Link from "next/link";
import { GenerateForm } from "@/components/studio/generate-form";
import { getDefaultCheckpoint, getDefaultImageModel } from "@/lib/studio/config";
import { FLUX_UI_NOTE, buildImageModelOptions } from "@/lib/studio/flux";
import { listInstalledCheckpoints } from "@/lib/studio/models";

export const dynamic = "force-dynamic";

export default async function StudioGeneratePage() {
  const checkpoints = await listInstalledCheckpoints();
  const sdxlDefault = getDefaultCheckpoint();
  const defaultModel = getDefaultImageModel();
  const imageModels = buildImageModelOptions(sdxlDefault, checkpoints);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-teal-300/70">
          Obraz
        </p>
        <h1
          className="text-3xl font-semibold tracking-tight text-stone-50 sm:text-4xl"
          style={{ fontFamily: "var(--font-studio-display), system-ui" }}
        >
          Generuj
        </h1>
        <p className="max-w-2xl text-stone-400">
          Domyślnie{" "}
          <strong className="font-medium text-stone-300">Flux.2 Dev (fp8)</strong>{" "}
          — SDXL zostaje w liście modeli. Wagi:{" "}
          <Link href="/models" className="text-teal-300/90 hover:underline">
            Modele
          </Link>
          .
        </p>
        <p className="max-w-2xl text-sm text-amber-200/75">{FLUX_UI_NOTE}</p>
      </header>
      <GenerateForm
        defaultModel={defaultModel}
        checkpoints={checkpoints}
        imageModels={imageModels}
        kind="image"
        imageLimitsNote={FLUX_UI_NOTE}
      />
    </div>
  );
}
