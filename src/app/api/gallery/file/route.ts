import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { requireStudioApiAuth } from "@/lib/studio/api-auth";
import { readGalleryFile } from "@/lib/studio/gallery";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await requireStudioApiAuth();
  if (denied) return denied;

  const url = new URL(request.url);
  const relative = url.searchParams.get("path");
  if (!relative) {
    return NextResponse.json({ ok: false, error: "Brak path" }, { status: 400 });
  }

  const file = await readGalleryFile(relative);
  if (!file) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const nodeStream = createReadStream(file.absPath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;

  return new NextResponse(webStream, {
    headers: {
      "Content-Type": file.mime,
      "Cache-Control": "private, max-age=60",
    },
  });
}
