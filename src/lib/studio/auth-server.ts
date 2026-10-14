import { cookies } from "next/headers";
import {
  STUDIO_SESSION_COOKIE,
  isValidStudioSessionToken,
  isStudioPasswordRequired,
} from "./auth";

/** Server Components / Route Handlers — true gdy dostęp dozwolony. */
export async function isStudioAuthenticated(): Promise<boolean> {
  if (!isStudioPasswordRequired()) return true;
  const jar = await cookies();
  return isValidStudioSessionToken(jar.get(STUDIO_SESSION_COOKIE)?.value);
}
