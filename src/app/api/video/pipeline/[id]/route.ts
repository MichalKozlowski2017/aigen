import { after, NextResponse } from "next/server";
import { requireStudioApiAuth } from "@/lib/studio/api-auth";
import {
  advancePipeline,
  getPipeline,
  kickPipelineBackground,
  pipelineToJobView,
} from "@/lib/studio/video-pipeline";

export const dynamic = "force-dynamic";
/** Tick może enqueue kolejny chunk lub odpalić stitch. */
export const maxDuration = 300;

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

  const existing = await getPipeline(id);
  if (!existing) {
    return NextResponse.json(
      { ok: false, error: "Pipeline nie znaleziony (wygasł lub zły id)" },
      { status: 404 }
    );
  }

  try {
    const pipeline = await advancePipeline(id);
    const job = pipelineToJobView(pipeline);

    if (pipeline.status !== "completed" && pipeline.status !== "failed") {
      after(() => {
        kickPipelineBackground(pipeline.id, 180_000);
      });
    }

    return NextResponse.json({
      ok: true,
      pipelineId: pipeline.id,
      job,
      chunkInfo: job.chunk,
      clipsDone: pipeline.clips.length,
      chunkCount: pipeline.plan.chunkCount,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Pipeline tick failed",
      },
      { status: 502 }
    );
  }
}
