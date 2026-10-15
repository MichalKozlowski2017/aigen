import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStudioApiAuth } from "@/lib/studio/api-auth";
import { preparePromptForModel } from "@/lib/studio/prompt-boost";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  prompt: z.string().max(4000).default(""),
  negativePrompt: z.string().max(4000).optional().default(""),
  kind: z.enum(["image", "video"]).optional().default("image"),
});

/** Podgląd / przygotowanie promptu PL→EN bez kolejkowania Comfy. */
export async function POST(request: Request) {
  const denied = await requireStudioApiAuth();
  if (denied) return denied;

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Nieprawidłowe dane", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  if (!parsed.data.prompt.trim()) {
    return NextResponse.json({
      ok: true,
      modelPrompt: "",
      modelNegative: parsed.data.negativePrompt,
      translated: false,
      negativeTranslated: false,
      boosted: false,
      detectedPolish: false,
      provider: "none",
      warnings: [] as string[],
    });
  }

  const result = await preparePromptForModel({
    prompt: parsed.data.prompt,
    negativePrompt: parsed.data.negativePrompt,
    kind: parsed.data.kind,
  });

  return NextResponse.json({ ok: true, ...result });
}
