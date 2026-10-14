import { NextResponse } from "next/server";
import { requireStudioApiAuth } from "@/lib/studio/api-auth";
import { comfyViewUrl } from "@/lib/studio/comfy-client";

export const dynamic = "force-dynamic";

/** Proxy podglądu pliku z ComfyUI /view (unika CORS w przeglądarce). */
export async function GET(request: Request) {
  const denied = await requireStudioApiAuth();
  if (denied) return denied;

  const url = new URL(request.url);
  const filename = url.searchParams.get("filename");
  if (!filename) {
    return NextResponse.json({ ok: false, error: "Brak filename" }, { status: 400 });
  }
  const subfolder = url.searchParams.get("subfolder") ?? "";
  const type = url.searchParams.get("type") ?? "output";

  try {
    const target = comfyViewUrl(filename, subfolder, type);
    const res = await fetch(target, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `Comfy view HTTP ${res.status}` },
        { status: 502 }
      );
    }
    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    const buf = await res.arrayBuffer();
    return new NextResponse(buf, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=30",
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "View proxy failed",
      },
      { status: 502 }
    );
  }
}
