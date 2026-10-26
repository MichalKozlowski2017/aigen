import { NextResponse } from "next/server";
import { requireStudioApiAuth } from "@/lib/studio/api-auth";
import { getEngineSwitchView, postEngineSwitch } from "@/lib/studio/engine-switch";
import { engineSwitchBodySchema } from "@/lib/studio/schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Panel (także Vercel) → Legion engine-control.
 * Sesja STUDIO_PASSWORD jak reszta /api/*. Sekret Bearer dokleja serwer.
 * Procesy startuje tylko Legion (engine-control.py). Tunel Comfy nie jest powłoką.
 */
export async function GET() {
  const denied = await requireStudioApiAuth();
  if (denied) return denied;
  const status = await getEngineSwitchView();
  return NextResponse.json(status);
}

export async function POST(request: Request) {
  const denied = await requireStudioApiAuth();
  if (denied) return denied;

  const json = await request.json().catch(() => null);
  const parsed = engineSwitchBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Nieprawidłowe dane" },
      { status: 400 }
    );
  }

  const result = await postEngineSwitch(parsed.data);
  return NextResponse.json(result.body, { status: result.httpStatus });
}
