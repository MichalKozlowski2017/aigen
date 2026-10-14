import { ModelsClient } from "@/components/studio/models-client";
import { listModelsLibrary } from "@/lib/studio/models";

export const dynamic = "force-dynamic";

export default async function StudioModelsPage() {
  const library = await listModelsLibrary();

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-teal-300/70">
          Biblioteka
        </p>
        <h1
          className="text-3xl font-semibold tracking-tight text-stone-50 sm:text-4xl"
          style={{ fontFamily: "var(--font-studio-display), system-ui" }}
        >
          Modele
        </h1>
        <p className="max-w-2xl text-stone-400">
          Polecane checkpointy, LoRA i VAE pod ~16 GB VRAM. Pobieranie zapisuje pliki
          wyłącznie w katalogu ComfyUI models.
        </p>
      </header>
      <ModelsClient
        initialItems={library.items}
        configured={library.configured}
        message={library.message}
        modelsDir={library.modelsDir}
      />
    </div>
  );
}
