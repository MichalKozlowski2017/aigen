import { after, NextResponse } from "next/server";
import { requireStudioApiAuth } from "@/lib/studio/api-auth";
import {
  advancePipeline,
  kickPipelineBackground,
  pipelineToJobView,
  rehydratePipeline,
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

  // Memory/tmp na Vercel ginie — najpierw rehydrate z Comfy input
  const existing = await rehydratePipeline(id);
  if (!existing) {
    return NextResponse.json(
      {
        ok: false,
        recoverable: true,
        error:
          "Pipeline chwilowo niedostępny (cold start) — odzyskuję stan z Comfy…",
        code: "PIPELINE_REHYDRATING",
      },
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
      durableSavedAt: pipeline.durableSavedAt ?? null,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Pipeline tick failed";
    const missing = /nie znaleziony/i.test(message);
    return NextResponse.json(
      {
        ok: false,
        recoverable: missing,
        error: missing
          ? "Pipeline chwilowo niedostępny — ponawiam odzyskiwanie…"
          : message,
        code: missing ? "PIPELINE_REHYDRATING" : "PIPELINE_TICK_FAILED",
      },
      { status: missing ? 404 : 502 }
    );
  }
}
