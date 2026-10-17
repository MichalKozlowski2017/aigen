import { after, NextResponse } from "next/server";
import { requireStudioApiAuth } from "@/lib/studio/api-auth";
import { checkComfyHealth } from "@/lib/studio/comfy-client";
import { isPipelineLegionWorker } from "@/lib/studio/config";
import {
  friendlyComfyError,
  formatFriendlyErrorLines,
} from "@/lib/studio/comfy-errors";
import { generateBodySchema } from "@/lib/studio/schemas";
import {
  kickPipelineBackground,
  pipelineToJobView,
  startVideoPipeline,
} from "@/lib/studio/video-pipeline";
import { isChunkedVideoEngine, planVideo } from "@/lib/studio/workflow-builder";

export const dynamic = "force-dynamic";
/** Start + enqueue c0; tło dociąga kolejne chunki w ramach budżetu. */
export const maxDuration = 300;

/**
 * Start pipeline (enqueue c0).
 *
 * Kolejne chunki: Legion worker (preferowane) albo Vercel `after()` best-effort.
 * Browser poll (`GET …/[id]`) NIE jest source of truth — tylko status + opcjonalny advance.
 */
export async function POST(request: Request) {
  const denied = await requireStudioApiAuth();
  if (denied) return denied;

  const health = await checkComfyHealth();
  if (!health.online) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "ComfyUI jest offline. Uruchom silnik lokalnie i sprawdź COMFYUI_URL.",
        health,
      },
      { status: 503 }
    );
  }

  const json = await request.json().catch(() => null);
  const parsed = generateBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Nieprawidłowe dane", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  if (parsed.data.kind !== "video") {
    return NextResponse.json(
      { ok: false, error: "Pipeline tylko dla wideo" },
      { status: 400 }
    );
  }

  const engine = parsed.data.videoEngine ?? "wan";
  if (!isChunkedVideoEngine(engine)) {
    return NextResponse.json(
      { ok: false, error: "Pipeline tylko dla Wan/LTX (chunked)" },
      { status: 400 }
    );
  }

  if (!parsed.data.startImage?.trim()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Workflow wideo wymaga obrazu startowego — wgraj plik albo podaj nazwę w Comfy input.",
      },
      { status: 400 }
    );
  }

  const previewPlan = planVideo(parsed.data);
  const needsPost = Boolean(parsed.data.postRife || parsed.data.postUpscale);
  if (!previewPlan.chunkPlan?.chunked && !needsPost) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Ten klip mieści się w 1 chunku — użyj zwykłego /api/generate zamiast pipeline.",
        videoPlan: previewPlan,
      },
      { status: 400 }
    );
  }

  try {
    const { pipeline, warnings } = await startVideoPipeline(parsed.data);
    const job = pipelineToJobView(pipeline);
    const legionWorker = isPipelineLegionWorker();

    // Bez Legion worker: best-effort after() (jedna pętla na start — nie na każde poll).
    // Z Legion worker: worker woła POST …/register i orkiestruje chunki.
    if (!legionWorker) {
      after(() => {
        kickPipelineBackground(pipeline.id);
      });
    }

    return NextResponse.json({
      ok: true,
      pipelineId: pipeline.id,
      promptId: job.promptId,
      job,
      videoPlan: previewPlan,
      engine: pipeline.engine,
      modelPrompt: pipeline.modelPrompt,
      modelNegative: pipeline.modelNegative,
      promptBoost: {
        warnings,
      },
      chunkInfo: job.chunk,
      advanceMode: legionWorker ? "legion-worker" : "vercel-best-effort",
    });
  } catch (err) {
    const attached = (
      err as Error & {
        friendly?: ReturnType<typeof friendlyComfyError>;
        nodeErrors?: unknown;
        comfyError?: unknown;
      }
    ).friendly;
    const friendly = attached ?? friendlyComfyError(err);
    return NextResponse.json(
      {
        ok: false,
        error: formatFriendlyErrorLines(friendly),
        errorDetail: {
          ...friendly,
          nodeErrors: friendly.nodeErrors ?? null,
          comfyError: friendly.comfyError ?? null,
        },
      },
      { status: 502 }
    );
  }
}
