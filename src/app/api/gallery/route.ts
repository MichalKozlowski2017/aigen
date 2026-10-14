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
  });
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Nieprawidłowe parametry" },
      { status: 400 }
    );
  }

  const result = await listGallery(parsed.data);
  return NextResponse.json({ ok: true, ...result });
}
