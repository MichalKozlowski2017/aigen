import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  STUDIO_SESSION_COOKIE,
  isValidStudioSessionToken,
} from "@/lib/studio/auth";

const PUBLIC_PATHS = new Set([
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  /** Legion publish — własny Bearer (COMFY_URL_UPDATE_SECRET), bez cookie sesji. */
  "/api/settings/comfy-url",
]);

/**
 * Ochrona panelu i /api/* gdy STUDIO_PASSWORD jest ustawione.
 */
export function proxy(request: NextRequest) {
  const password = process.env.STUDIO_PASSWORD?.trim();
  if (!password) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(STUDIO_SESSION_COOKIE)?.value;
  if (isValidStudioSessionToken(token)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const login = new URL("/login", request.url);
  login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
