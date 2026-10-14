import { NextResponse } from "next/server";
import { requireStudioApiAuth } from "@/lib/studio/api-auth";
import { checkComfyHealth } from "@/lib/studio/comfy-client";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireStudioApiAuth();
  if (denied) return denied;

  const health = await checkComfyHealth();
  return NextResponse.json({ ok: true, health });
}
