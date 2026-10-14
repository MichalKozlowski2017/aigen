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
          Pliki z <code className="text-stone-300">COMFYUI_OUTPUT_DIR</code> — obrazy i
          MP4.
        </p>
      </header>
      <GalleryClient
        initialItems={result.items}
        configured={result.configured}
        message={result.error}
      />
    </div>
  );
}
