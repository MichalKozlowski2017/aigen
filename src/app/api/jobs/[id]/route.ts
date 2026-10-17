import { NextResponse } from "next/server";
import { requireStudioApiAuth } from "@/lib/studio/api-auth";
import { getJobStatus } from "@/lib/studio/comfy-client";
import { recordGalleryOutputs } from "@/lib/studio/gallery-index";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const denied = await requireStudioApiAuth();
  if (denied) return denied;

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ ok: false, error: "Brak id" }, { status: 400 });
  }

  try {
    const job = await getJobStatus(id);
    // Po wipe `/history` galeria czyta indeks w Comfy input — dopisz outputy joba.
    if (job.status === "completed" && job.outputs.length > 0) {
      void recordGalleryOutputs(job.outputs);
    }
    return NextResponse.json({ ok: true, job });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Job status failed",
      },
      { status: 502 }
    );
  }
}
