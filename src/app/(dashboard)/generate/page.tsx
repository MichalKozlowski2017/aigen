import Link from "next/link";
import { GenerateForm } from "@/components/studio/generate-form";
import { getDefaultCheckpoint } from "@/lib/studio/config";
import { listInstalledCheckpoints } from "@/lib/studio/models";

export const dynamic = "force-dynamic";

export default async function StudioGeneratePage() {
  const checkpoints = await listInstalledCheckpoints();
  const defaultModel = getDefaultCheckpoint();

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
          Workflow SDXL (API JSON). Zainstaluj checkpoint{" "}
          <code className="text-stone-300">{defaultModel}</code> albo wybierz inny
          z listy — patrz{" "}
          <Link href="/models" className="text-teal-300/90 hover:underline">
            Modele
          </Link>
          .
        </p>
      </header>
      <GenerateForm defaultModel={defaultModel} checkpoints={checkpoints} kind="image" />
    </div>
  );
}
