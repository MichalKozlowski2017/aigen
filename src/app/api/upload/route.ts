import { NextResponse } from "next/server";
import { requireStudioApiAuth } from "@/lib/studio/api-auth";
import { checkComfyHealth, uploadImageToComfy } from "@/lib/studio/comfy-client";

export const dynamic = "force-dynamic";

const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

const MAX_BYTES = 15 * 1024 * 1024;

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
        health,
      },
      { status: 503 }
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Nieprawidłowy formularz (oczekiwano multipart)" },
      { status: 400 }
    );
  }

  const file = form.get("image") ?? form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: "Brak pliku obrazu (pole image)" },
      { status: 400 }
    );
  }

  if (file.size <= 0 || file.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: "Plik musi mieć 1 B–15 MB" },
      { status: 400 }
    );
  }

  const type = (file.type || "").toLowerCase();
  const nameLower = file.name.toLowerCase();
  const extOk = /\.(png|jpe?g|webp|gif)$/i.test(nameLower);
  if (type && !ALLOWED_TYPES.has(type) && !extOk) {
    return NextResponse.json(
      { ok: false, error: "Dozwolone: PNG, JPEG, WebP, GIF" },
      { status: 400 }
    );
  }
  if (!type && !extOk) {
    return NextResponse.json(
      { ok: false, error: "Dozwolone: PNG, JPEG, WebP, GIF" },
      { status: 400 }
    );
  }

  const safeBase =
    file.name.replace(/[^\w.\-]+/g, "_").replace(/^\.+/, "") || "start.png";
  const filename = safeBase.length > 180 ? safeBase.slice(-180) : safeBase;

  try {
    const uploaded = await uploadImageToComfy(file, filename, {
      overwrite: true,
    });
    const startImage = uploaded.subfolder
      ? `${uploaded.subfolder}/${uploaded.name}`
      : uploaded.name;
    return NextResponse.json({
      ok: true,
      startImage,
      name: uploaded.name,
      subfolder: uploaded.subfolder,
      type: uploaded.type,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Upload do ComfyUI nieudany",
      },
      { status: 502 }
    );
  }
}
