import { NextResponse } from "next/server";
import { requireStudioApiAuth } from "@/lib/studio/api-auth";
import { checkComfyHealth, enqueuePrompt } from "@/lib/studio/comfy-client";
import {
  friendlyComfyError,
  formatFriendlyErrorLines,
} from "@/lib/studio/comfy-errors";
import { ensureStartImageInComfyInput } from "@/lib/studio/ensure-start-image";
import { preparePromptForModel } from "@/lib/studio/prompt-boost";
import { generateBodySchema } from "@/lib/studio/schemas";
import { buildWorkflow, planVideo } from "@/lib/studio/workflow-builder";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = await requireStudioApiAuth();
  if (denied) return denied;

  const json = await request.json().catch(() => null);
  const parsed = generateBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Nieprawidłowe dane", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

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

  if (parsed.data.kind === "video" && !parsed.data.startImage?.trim()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Workflow wideo wymaga obrazu startowego — wgraj plik powyżej promptu albo podaj nazwę w Comfy input.",
      },
      { status: 400 }
    );
  }

  try {
    let startImage = parsed.data.startImage?.trim();
    let copiedFromOutput = false;
    let sourceUsed: string | undefined;
    if (parsed.data.kind === "video" && startImage) {
      const ensured = await ensureStartImageInComfyInput(
        startImage,
        parsed.data.startImageSource ?? null
      );
      startImage = ensured.startImage;
      copiedFromOutput = ensured.copiedFromOutput;
      sourceUsed = ensured.sourceUsed;
    }

    const boost = await preparePromptForModel({
      prompt: parsed.data.prompt,
      negativePrompt: parsed.data.negativePrompt,
      kind: parsed.data.kind,
    });

    const bodyForComfy = {
      ...parsed.data,
      prompt: boost.modelPrompt,
      negativePrompt: boost.modelNegative,
      startImage,
    };

    const videoPlan =
      parsed.data.kind === "video" ? planVideo(bodyForComfy) : null;

    const { workflow, template, engine, warnings: wfWarnings } =
      await buildWorkflow(bodyForComfy);
    const result = await enqueuePrompt(workflow);
    const boostWarnings = [
      ...boost.warnings,
      ...(wfWarnings ?? []),
    ];
    return NextResponse.json({
      ok: true,
      promptId: result.promptId,
      number: result.number,
      template,
      engine,
      kind: parsed.data.kind,
      nodesTotal: result.nodesTotal,
      nodeErrors: result.nodeErrors,
      startImage,
      copiedFromOutput,
      sourceUsed,
      videoPlan,
      // Debug deploy: potwierdź loader na prod
      videoLoader:
        parsed.data.kind === "video"
          ? (
              (workflow["37"] as { class_type?: string } | undefined)?.class_type ??
              (workflow["10"] as { class_type?: string } | undefined)?.class_type ??
              (workflow["1"] as { class_type?: string } | undefined)?.class_type
            )
          : undefined,
      ltxChunkIndex: parsed.data.ltxChunkIndex,
      ltxChunkLength: parsed.data.ltxChunkLength,
      modelPrompt: boost.modelPrompt,
      modelNegative: boost.modelNegative,
      promptBoost: {
        translated: boost.translated,
        negativeTranslated: boost.negativeTranslated,
        boosted: boost.boosted,
        detectedPolish: boost.detectedPolish,
        provider: boost.provider,
        warnings: boostWarnings,
      },
    });
  } catch (err) {
    const e = err as Error & {
      friendly?: ReturnType<typeof friendlyComfyError>;
      nodeErrors?: unknown;
      comfyError?: unknown;
    };
    const engineHint =
      parsed.success && parsed.data.kind === "video"
        ? (parsed.data.videoEngine ?? "wan")
        : undefined;
    const rawForMap =
      e.nodeErrors != null || e.comfyError != null
        ? { error: e.comfyError, node_errors: e.nodeErrors }
        : err;
    const friendly = friendlyComfyError(
      rawForMap,
      engineHint ? { engine: engineHint } : undefined
    );
    const nodeErrors = friendly.nodeErrors ?? e.nodeErrors ?? null;
    const comfyError = friendly.comfyError ?? e.comfyError ?? null;
    return NextResponse.json(
      {
        ok: false,
        error: formatFriendlyErrorLines(friendly),
        errorDetail: {
          ...friendly,
          nodeErrors,
          comfyError,
        },
        nodeErrors,
        comfyError,
      },
      { status: 502 }
    );
  }
}
