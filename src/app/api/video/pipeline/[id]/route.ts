import { after, NextResponse } from "next/server";
import { requireStudioApiAuth } from "@/lib/studio/api-auth";
import { isPipelineLegionWorker } from "@/lib/studio/config";
import {
  advancePipeline,
  getPipeline,
  kickPipelineBackground,
  pipelineToJobView,
  rehydratePipeline,
  shouldKickPipelineBackground,
} from "@/lib/studio/video-pipeline";

export const dynamic = "force-dynamic";
/** Tick może enqueue kolejny chunk lub odpalić stitch. */
export const maxDuration = 300;

/**
 * GET status pipeline.
 *
 * - Domyślnie: advance + rzadki awaited after() kick (+ durable Comfy JSON).
 * - `PIPELINE_LEGION_WORKER=1` (eksperymentalne, niezalecane domyślnie): tylko odczyt.
 * Browser poll NIE jest jedynym źródłem postępu — advance działa też bez UI.
 */
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

  const legionWorker = isPipelineLegionWorker();

  try {
    // Legion SoT: panel tylko czyta; inaczej best-effort advance przy pollu
    const pipeline = legionWorker
      ? ((await getPipeline(id)) ?? existing)
      : await advancePipeline(id);
    const job = pipelineToJobView(pipeline);

    if (
      !legionWorker &&
      pipeline.status !== "completed" &&
      pipeline.status !== "failed" &&
      shouldKickPipelineBackground(pipeline.id)
    ) {
      after(async () => {
        await kickPipelineBackground(pipeline.id, 180_000);
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
      advanceMode: legionWorker ? "legion-worker" : "vercel-best-effort",
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
