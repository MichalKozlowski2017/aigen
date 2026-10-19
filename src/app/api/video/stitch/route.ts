import { NextResponse } from "next/server";
import { requireStudioApiAuth } from "@/lib/studio/api-auth";
import { checkComfyHealth } from "@/lib/studio/comfy-client";
import { recordGalleryOutputs } from "@/lib/studio/gallery-index";
import { stitchBodySchema } from "@/lib/studio/schemas";
import { stitchComfyClips } from "@/lib/studio/video-stitch";

export const dynamic = "force-dynamic";
/** Stitch może chwilę trwać (download + ffmpeg + upload). */
export const maxDuration = 120;

export async function POST(request: Request) {
  const denied = await requireStudioApiAuth();
  if (denied) return denied;

  const health = await checkComfyHealth();
  if (!health.online) {
    return NextResponse.json(
      { ok: false, error: "ComfyUI offline — stitch wymaga tunelu." },
      { status: 503 }
    );
  }

  const json = await request.json().catch(() => null);
  const parsed = stitchBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Nieprawidłowe dane", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const result = await stitchComfyClips({
      clips: parsed.data.clips,
      fps: parsed.data.fps,
      overlapFrames: parsed.data.overlapFrames,
      filenamePrefix: parsed.data.filenamePrefix,
    });
    const viewUrl = `/api/comfy-view?${new URLSearchParams({
      filename: result.filename,
      subfolder: result.subfolder,
      type: result.type,
    }).toString()}`;
    await recordGalleryOutputs([
      {
        filename: result.filename,
        subfolder: result.subfolder,
        type: result.type || "output",
      },
    ]);
    return NextResponse.json({
      ok: true,
      ...result,
      url: viewUrl,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Stitch nieudany",
      },
      { status: 502 }
    );
  }
}
