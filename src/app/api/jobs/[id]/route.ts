import { NextResponse } from "next/server";
import { requireStudioApiAuth } from "@/lib/studio/api-auth";
import { getJobStatus } from "@/lib/studio/comfy-client";
import { recordGalleryOutputs } from "@/lib/studio/gallery-index";
import {
  MinimaxConfigError,
  getMinimaxJob,
  parseMinimaxPromptId,
} from "@/lib/studio/minimax-video";

export const dynamic = "force-dynamic";
/** Pobranie MP4 H3-Lite może zająć chwilę po statusie succeeded. */
export const maxDuration = 120;

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

  if (parseMinimaxPromptId(id)) {
    try {
      const job = await getMinimaxJob(id);
      if (!job) {
        return NextResponse.json(
          { ok: false, error: "Nieznane zadanie MiniMax" },
          { status: 404 }
        );
      }
      return NextResponse.json({ ok: true, job });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Status MiniMax nieudany";
      const status = err instanceof MinimaxConfigError ? 503 : 502;
      return NextResponse.json({ ok: false, error: message }, { status });
    }
  }

  try {
    const job = await getJobStatus(id);
    // Po wipe `/history` galeria czyta indeks w Comfy input — dopisz outputy joba.
    if (job.status === "completed" && job.outputs.length > 0) {
      // Await z krótkim budżetem — void gubił błędy przy zdrowym indeksie
      // (gallery index-first pomija /history → nowe PNG/MP4 niewidoczne).
      try {
        await Promise.race([
          recordGalleryOutputs(job.outputs),
          new Promise<{ ok: false; count: number; error: string }>((resolve) =>
            setTimeout(
              () =>
                resolve({
                  ok: false,
                  count: 0,
                  error: "gallery index timeout",
                }),
              8_000
            )
          ),
        ]);
      } catch {
        // best-effort
      }
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
