import { GalleryClient } from "@/components/studio/gallery-client";
import { listGallery } from "@/lib/studio/gallery";

export const dynamic = "force-dynamic";

export default async function StudioGalleryPage() {
  const result = await listGallery({ kind: "all", limit: 60 });

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-teal-300/70">
          Output
        </p>
        <h1
          className="text-3xl font-semibold tracking-tight text-stone-50 sm:text-4xl"
          style={{ fontFamily: "var(--font-studio-display), system-ui" }}
        >
          Galeria
        </h1>
        <p className="max-w-2xl text-stone-400">
          {result.source === "comfy"
            ? "Outputy przez COMFYUI_URL / tunel: historia Comfy, indeks aigen-gallery-index.json oraz /internal/files/output."
            : result.source === "local"
              ? "Pliki z COMFYUI_OUTPUT_DIR — obrazy i MP4."
              : "Lokalny katalog output albo Comfy przez tunel (historia / indeks)."}
        </p>
      </header>
      <GalleryClient
        initialItems={result.items}
        configured={result.configured}
        message={result.error}
        source={result.source}
      />
    </div>
  );
}
