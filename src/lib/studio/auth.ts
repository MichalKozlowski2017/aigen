import { createHmac, timingSafeEqual } from "node:crypto";

export const STUDIO_SESSION_COOKIE = "studio_session";

function studioPassword(): string | null {
  const t = process.env.STUDIO_PASSWORD?.trim();
  return t ? t : null;
}

function sessionSecret(): string {
  return studioPassword() ?? "studio-open-local";
}

export function createStudioSessionToken(password: string): string {
  return createHmac("sha256", sessionSecret()).update(password).digest("hex");
}

export function expectedStudioSessionToken(): string | null {
  const password = studioPassword();
  if (!password) return null;
  return createStudioSessionToken(password);
}

export function isValidStudioSessionToken(
  token: string | undefined | null
): boolean {
  const expected = expectedStudioSessionToken();
  if (!expected) return true;
  if (!token || token.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function verifyStudioPassword(password: string): boolean {
  const expected = studioPassword();
  if (!expected) return true;
  if (password.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(password), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function isStudioPasswordRequired(): boolean {
  return Boolean(studioPassword());
}
