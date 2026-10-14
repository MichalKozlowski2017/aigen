import { NextResponse } from "next/server";
import { requireStudioApiAuth } from "@/lib/studio/api-auth";
import { listDownloadJobs, startModelDownload } from "@/lib/studio/downloads";
import { downloadBodySchema } from "@/lib/studio/schemas";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireStudioApiAuth();
  if (denied) return denied;
  return NextResponse.json({ ok: true, jobs: listDownloadJobs() });
}

export async function POST(request: Request) {
  const denied = await requireStudioApiAuth();
  if (denied) return denied;

  const json = await request.json().catch(() => null);
  const parsed = downloadBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Nieprawidłowe dane" },
      { status: 400 }
    );
  }

  const result = await startModelDownload(parsed.data.modelId);
  if ("error" in result) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status }
    );
  }
  return NextResponse.json({ ok: true, job: result.job });
}
