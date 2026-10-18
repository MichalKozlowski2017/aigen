import { NextResponse } from "next/server";
import {
  getComfyUrlUpdateSecret,
  setComfyUrlOverride,
} from "@/lib/studio/comfy-url-store";
import { getComfyUrlAsync } from "@/lib/studio/config";

export const dynamic = "force-dynamic";

function extractBearer(request: Request): string | undefined {
  const header = request.headers.get("authorization")?.trim();
  if (!header) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(header);
  return m?.[1]?.trim() || undefined;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

function authorize(request: Request): NextResponse | null {
  const expected = getComfyUrlUpdateSecret();
  if (!expected) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Brak COMFY_URL_UPDATE_SECRET (lub REVALIDATE_SECRET) na Vercel — ustaw sekret przed auto-publish.",
      },
      { status: 503 }
    );
  }

  const provided =
    extractBearer(request) ??
    request.headers.get("x-comfy-url-secret")?.trim() ??
    undefined;

  if (!provided || !timingSafeEqual(provided, expected)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/** Aktualny efektywny URL (env + runtime override / KV). */
export async function GET(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;

  const url = await getComfyUrlAsync();
  return NextResponse.json({
    ok: true,
    url,
    kvConfigured: Boolean(
      process.env.KV_REST_API_URL?.trim() &&
        process.env.KV_REST_API_TOKEN?.trim()
    ),
  });
}

/**
 * Legion → Vercel: opublikuj nowy Quick Tunnel URL bez redeploy / Settings UI.
 * Auth: Authorization: Bearer <COMFY_URL_UPDATE_SECRET|REVALIDATE_SECRET>
 * Body: { "url": "https://….trycloudflare.com" }
 */
export async function POST(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const raw =
    typeof body === "object" &&
    body !== null &&
    "url" in body &&
    typeof (body as { url: unknown }).url === "string"
      ? (body as { url: string }).url
      : null;

  if (!raw) {
    return NextResponse.json(
      { ok: false, error: "Brak pola url (string)" },
      { status: 400 }
    );
  }

  try {
    const result = await setComfyUrlOverride(raw);
    return NextResponse.json({
      ok: true,
      url: result.url,
      durable: result.durable,
      kvConfigured: result.kvConfigured,
      hint: result.durable
        ? "Zapisano w KV — galeria/proxy użyją nowego URL bez redeploy."
        : result.kvConfigured
          ? "KV skonfigurowane, ale zapis nieudany — override tylko w pamięci tej instancji."
          : "Brak Vercel KV (KV_REST_API_*) — override w pamięci warm instance. Włącz KV albo użyj -UpdateVercelEnv w skrypcie Legion.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid URL";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
