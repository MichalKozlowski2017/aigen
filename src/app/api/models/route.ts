import { NextResponse } from "next/server";
import { requireStudioApiAuth } from "@/lib/studio/api-auth";
import { listInstalledCheckpoints, listModelsLibrary } from "@/lib/studio/models";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireStudioApiAuth();
  if (denied) return denied;

  const library = await listModelsLibrary();
  const checkpoints = await listInstalledCheckpoints();
  return NextResponse.json({ ok: true, ...library, checkpoints });
}
