import { NextResponse } from "next/server";
import { isStudioAuthenticated } from "./auth-server";

/** Sprawdza sesję Studio w Route Handlerze. null = OK. */
export async function requireStudioApiAuth(): Promise<NextResponse | null> {
  if (await isStudioAuthenticated()) return null;
  return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}
