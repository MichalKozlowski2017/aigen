import { NextResponse } from "next/server";
import { requireStudioApiAuth } from "@/lib/studio/api-auth";
import { checkComfyHealth, enqueuePrompt } from "@/lib/studio/comfy-client";
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

  if (parsed.data.kind === "video" && !parsed.data.startImage) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Workflow wideo (SVD) wymaga obrazu startowego w folderze input ComfyUI (pole startImage).",
      },
      { status: 400 }
    );
  }

  try {
    const { workflow, template } = buildWorkflow(parsed.data);
    const result = await enqueuePrompt(workflow);
    return NextResponse.json({
      ok: true,
      promptId: result.promptId,
      number: result.number,
      template,
      kind: parsed.data.kind,
      nodeErrors: result.nodeErrors,
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
