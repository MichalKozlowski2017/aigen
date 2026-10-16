import { NextResponse } from "next/server";
import { requireStudioApiAuth } from "@/lib/studio/api-auth";
import { getComfyUrl } from "@/lib/studio/config";
import {
  comfyViewSubfolderFallbacks,
  mimeFromFilename,
  normalizeComfyMediaRef,
} from "@/lib/studio/comfy-media";

export const dynamic = "force-dynamic";

/**
 * Proxy ComfyUI /view — unika CORS, ustawia Content-Type, obsługuje Range (mobile Safari).
 * Dla VHS: subfolder=studio jest wymagany (output/studio/video_00001.mp4).
 */
export async function GET(request: Request) {
  const denied = await requireStudioApiAuth();
  if (denied) return denied;

  const url = new URL(request.url);
  const rawName = url.searchParams.get("filename");
  if (!rawName) {
    return NextResponse.json({ ok: false, error: "Brak filename" }, { status: 400 });
  }

  const normalized = normalizeComfyMediaRef(
    rawName,
    url.searchParams.get("subfolder") ?? "",
    url.searchParams.get("type") ?? "output"
  );

  const range = request.headers.get("range");
  const base = getComfyUrl().replace(/\/$/, "");
  const candidates = comfyViewSubfolderFallbacks(normalized.subfolder);

  let lastStatus = 404;
  let lastError = "Comfy view not found";

  for (const sub of candidates) {
    try {
      const q = new URLSearchParams({
        filename: normalized.filename,
        subfolder: sub,
        type: normalized.type,
      });
      const headers = new Headers();
      if (range) headers.set("Range", range);

      const res = await fetch(`${base}/view?${q.toString()}`, {
        headers,
        cache: "no-store",
      });
      lastStatus = res.status;

      if (res.status === 404 || res.status === 400) {
        lastError = `Comfy view HTTP ${res.status} (subfolder=${JSON.stringify(sub)})`;
        continue;
      }

      if (!res.ok && res.status !== 206) {
        lastError = `Comfy view HTTP ${res.status}`;
        // Nie próbuj fallbacków przy 401/5xx innych niż chwilowy brak pliku
        if (res.status >= 500) continue;
        return NextResponse.json(
          { ok: false, error: lastError },
          { status: 502 }
        );
      }

      const inferred = mimeFromFilename(normalized.filename);
      let contentType = res.headers.get("content-type") || inferred;
      // Tunnel / Comfy czasem oddaje octet-stream — mobile wymaga video/mp4
      if (
        contentType.includes("octet-stream") ||
        contentType.includes("json") ||
        contentType.includes("text/plain")
      ) {
        contentType = inferred;
      }

      const out = new Headers();
      out.set("Content-Type", contentType);
      out.set("Accept-Ranges", "bytes");
      out.set("Cache-Control", "private, max-age=60");
      out.set("X-Comfy-Subfolder", sub);
      out.set(
        "Content-Disposition",
        `inline; filename="${normalized.filename.replace(/"/g, "")}"`
      );

      const contentLength = res.headers.get("content-length");
      if (contentLength) out.set("Content-Length", contentLength);
      const contentRange = res.headers.get("content-range");
      if (contentRange) out.set("Content-Range", contentRange);

      // Stream (nie buforuj całego mp4) — krytyczne dla Range / mobile
      return new NextResponse(res.body, {
        status: res.status,
        headers: out,
      });
    } catch (err) {
      lastError =
        err instanceof Error ? err.message : "View proxy failed";
    }
  }

  return NextResponse.json(
    {
      ok: false,
      error: lastError,
      triedSubfolders: candidates,
      filename: normalized.filename,
      type: normalized.type,
    },
    { status: lastStatus === 404 ? 404 : 502 }
  );
}
