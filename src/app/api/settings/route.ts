import { NextResponse } from "next/server";
import { requireStudioApiAuth } from "@/lib/studio/api-auth";
import { getStudioPublicConfigAsync } from "@/lib/studio/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireStudioApiAuth();
  if (denied) return denied;

  return NextResponse.json({
    ok: true,
    config: await getStudioPublicConfigAsync(),
  });
}
