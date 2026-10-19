import { NextResponse } from "next/server";
import { requireStudioApiAuth } from "@/lib/studio/api-auth";
import { checkComfyHealth, freeComfyMemory } from "@/lib/studio/comfy-client";

export const dynamic = "force-dynamic";

/**
 * Soft unload modeli Comfy (POST {COMFYUI_URL}/free).
 * Body opcjonalne: { unload_models?, free_memory? } — domyślnie oba true.
 */
export async function POST(request: Request) {
  const denied = await requireStudioApiAuth();
  if (denied) return denied;

  const health = await checkComfyHealth();
  if (!health.online) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "ComfyUI jest offline. Uruchom silnik lokalnie i sprawdź COMFYUI_URL.",
      },
      { status: 503 }
    );
  }

  let unloadModels = true;
  let freeMemory = true;
  try {
    const body = (await request.json().catch(() => null)) as {
      unload_models?: unknown;
      free_memory?: unknown;
      unloadModels?: unknown;
      freeMemory?: unknown;
    } | null;
    if (body) {
      if (typeof body.unload_models === "boolean") {
        unloadModels = body.unload_models;
      } else if (typeof body.unloadModels === "boolean") {
        unloadModels = body.unloadModels;
      }
      if (typeof body.free_memory === "boolean") {
        freeMemory = body.free_memory;
      } else if (typeof body.freeMemory === "boolean") {
        freeMemory = body.freeMemory;
      }
    }
  } catch {
    /* empty body OK */
  }

  try {
    await freeComfyMemory({ unloadModels, freeMemory });
    return NextResponse.json({
      ok: true,
      unloaded: { unload_models: unloadModels, free_memory: freeMemory },
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error ? err.message : "Nie udało się zwolnić modeli",
      },
      { status: 502 }
    );
  }
}
