import { NextResponse } from "next/server";
import { requireStudioApiAuth } from "@/lib/studio/api-auth";
import { listGallery } from "@/lib/studio/gallery";
import { galleryQuerySchema } from "@/lib/studio/schemas";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await requireStudioApiAuth();
  if (denied) return denied;

  const url = new URL(request.url);
  const parsed = galleryQuerySchema.safeParse({
    kind: url.searchParams.get("kind") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
    refresh: url.searchParams.get("refresh") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Nieprawidłowe parametry" },
      { status: 400 }
    );
  }

  const result = await listGallery(parsed.data);
  const headers = new Headers();
  // Krótki private cache — Obrazy/Wideo filtrują po stronie klienta;
  // refresh=1 omija cache indeksu po stronie serwera.
  if (!parsed.data.refresh) {
    headers.set("Cache-Control", "private, max-age=15");
  } else {
    headers.set("Cache-Control", "no-store");
  }
  return NextResponse.json({ ok: true, ...result }, { headers });
}
