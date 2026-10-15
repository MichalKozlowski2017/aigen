import { NextResponse } from "next/server";
import { requireStudioApiAuth } from "@/lib/studio/api-auth";
import { checkComfyHealth, enqueuePrompt } from "@/lib/studio/comfy-client";
import { preparePromptForModel } from "@/lib/studio/prompt-boost";
import { generateBodySchema } from "@/lib/studio/schemas";
import { buildWorkflow } from "@/lib/studio/workflow-builder";

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
          "Workflow wideo (SVD) wymaga obrazu startowego — wgraj plik powyżej promptu albo podaj nazwę w Comfy input.",
      },
      { status: 400 }
    );
  }

  try {
    const boost = await preparePromptForModel({
      prompt: parsed.data.prompt,
      negativePrompt: parsed.data.negativePrompt,
      kind: parsed.data.kind,
    });

    const bodyForComfy = {
      ...parsed.data,
      prompt: boost.modelPrompt,
      negativePrompt: boost.modelNegative,
    };

    const { workflow, template } = buildWorkflow(bodyForComfy);
    const result = await enqueuePrompt(workflow);
    return NextResponse.json({
      ok: true,
      promptId: result.promptId,
      number: result.number,
      template,
      kind: parsed.data.kind,
      nodeErrors: result.nodeErrors,
      modelPrompt: boost.modelPrompt,
      modelNegative: boost.modelNegative,
      promptBoost: {
        translated: boost.translated,
        negativeTranslated: boost.negativeTranslated,
        boosted: boost.boosted,
        detectedPolish: boost.detectedPolish,
        provider: boost.provider,
        warnings: boost.warnings,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Enqueue failed",
      },
      { status: 502 }
    );
  }
}
