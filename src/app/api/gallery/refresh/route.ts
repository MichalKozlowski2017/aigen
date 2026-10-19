import { NextResponse } from "next/server";
import { requireStudioApiAuth } from "@/lib/studio/api-auth";
import { listGallery } from "@/lib/studio/gallery";
import { invalidateGalleryIndexCache } from "@/lib/studio/gallery-index";

export const dynamic = "force-dynamic";

/**
 * Lekkie „Odśwież indeks”: cache bust + ponowny odczyt aigen-gallery-index.json.
 * Pełny re-scan output/ wymaga seeda na Legionie:
 *   python scripts/seed-comfy-gallery-index.py --comfy-url http://127.0.0.1:8188
 */
export async function POST() {
  const denied = await requireStudioApiAuth();
  if (denied) return denied;

  invalidateGalleryIndexCache();
  const result = await listGallery({
    kind: "all",
    limit: 80,
    refresh: true,
  });

  return NextResponse.json(
    {
      ok: true,
      ...result,
      hint:
        result.source === "comfy"
          ? "Przeładowano indeks z Comfy. Pełny skan dysku: seed-comfy-gallery-index.py na Legionie."
          : undefined,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
