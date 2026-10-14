import { NextResponse } from "next/server";
import {
  STUDIO_SESSION_COOKIE,
  createStudioSessionToken,
  isStudioPasswordRequired,
  verifyStudioPassword,
} from "@/lib/studio/auth";
import { loginBodySchema } from "@/lib/studio/schemas";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isStudioPasswordRequired()) {
    return NextResponse.json({ ok: true, open: true });
  }

  const json = await request.json().catch(() => null);
  const parsed = loginBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Brak hasła" }, { status: 400 });
  }

  if (!verifyStudioPassword(parsed.data.password)) {
    return NextResponse.json(
      { ok: false, error: "Nieprawidłowe hasło" },
      { status: 401 }
    );
  }

  const token = createStudioSessionToken(parsed.data.password);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(STUDIO_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 14,
  });
  return res;
}
