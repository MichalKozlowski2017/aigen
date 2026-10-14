import { NextResponse } from "next/server";
import { requireStudioApiAuth } from "@/lib/studio/api-auth";
import { getHistory, getJobStatus, getQueue } from "@/lib/studio/comfy-client";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await requireStudioApiAuth();
  if (denied) return denied;

  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  if (id) {
    try {
      const job = await getJobStatus(id);
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

  try {
    const [queue, history] = await Promise.all([
      getQueue().catch(() => null),
      getHistory().catch(() => null),
    ]);
    return NextResponse.json({ ok: true, queue, history });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Jobs failed",
      },
      { status: 502 }
    );
  }
}
