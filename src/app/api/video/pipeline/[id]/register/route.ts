import { after, NextResponse } from "next/server";
import { requireStudioApiAuth } from "@/lib/studio/api-auth";
import {
  kickPipelineBackground,
  pipelineToJobView,
  rehydratePipeline,
  shouldKickPipelineBackground,
} from "@/lib/studio/video-pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/video/pipeline/[id]/register
 *
 * Rejestracja / claim pipeline przez Legion worker (source of truth).
 * Kickuje jedną pętlę advance w tle (bez multiplikacji na browser poll).
 * Panel z `PIPELINE_LEGION_WORKER=1` nie advance’uje na GET — worker woła tu.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const denied = await requireStudioApiAuth();
  if (denied) return denied;

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ ok: false, error: "Brak id" }, { status: 400 });
  }

  const pipeline = await rehydratePipeline(id);
  if (!pipeline) {
    return NextResponse.json(
      {
        ok: false,
        recoverable: true,
        error: "Pipeline nie znaleziony / cold start",
        code: "PIPELINE_REHYDRATING",
      },
      { status: 404 }
    );
  }

  const job = pipelineToJobView(pipeline);
  const kicked =
    pipeline.status !== "completed" &&
    pipeline.status !== "failed" &&
    shouldKickPipelineBackground(pipeline.id, 5_000);

  if (kicked) {
    after(() => {
      kickPipelineBackground(pipeline.id, 240_000);
    });
  }

  return NextResponse.json({
    ok: true,
    pipelineId: pipeline.id,
    registered: true,
    kicked,
    job,
    advanceMode: "register",
  });
}
