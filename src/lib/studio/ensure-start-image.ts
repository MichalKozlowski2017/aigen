import {
  uploadImageToComfy,
  comfyViewUrl,
} from "./comfy-client";

/**
 * LoadImage w Comfy widzi tylko pliki z katalogu **input**.
 * Nazwy z galerii / output (np. txt2img-flux2_00003_.png) często tam nie leżą
 * → VALIDATE_INPUTS: „Invalid image file” / „Prompt outputs failed validation”.
 *
 * Próbujemy: input → output (+ typowe subfoldery) → upload do input.
 */
export async function ensureStartImageInComfyInput(
  startImage: string
): Promise<{ startImage: string; copiedFromOutput: boolean }> {
  const raw = startImage.trim();
  if (!raw) {
    throw new Error("Brak nazwy obrazu startowego.");
  }

  const candidates: Array<{ filename: string; subfolder: string; type: string }> =
    [];

  const push = (filename: string, subfolder: string, type: string) => {
    candidates.push({ filename, subfolder, type });
  };

  // Jak podano „studio/foo.png”
  if (raw.includes("/")) {
    const i = raw.lastIndexOf("/");
    const sub = raw.slice(0, i);
    const file = raw.slice(i + 1);
    push(file, sub, "input");
    push(file, sub, "output");
    push(file, "", "input");
    push(file, "", "output");
  } else {
    push(raw, "", "input");
    push(raw, "", "output");
    push(raw, "studio", "output");
    push(raw, "studio/txt2img-flux", "output");
    push(raw, "studio/txt2img-flux2", "output");
  }

  const seen = new Set<string>();
  for (const c of candidates) {
    const key = `${c.type}:${c.subfolder}/${c.filename}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const blob = await tryFetchComfyView(c.filename, c.subfolder, c.type);
    if (!blob) continue;

    if (c.type === "input") {
      // Już w input — użyj oryginalnej ścieżki względnej jeśli miała subfolder
      const name = c.subfolder ? `${c.subfolder}/${c.filename}` : c.filename;
      return { startImage: name, copiedFromOutput: false };
    }

    // Skopiuj output → input
    const uploaded = await uploadImageToComfy(blob, c.filename, {
      overwrite: true,
    });
    const name = uploaded.subfolder
      ? `${uploaded.subfolder}/${uploaded.name}`
      : uploaded.name;
    return { startImage: name, copiedFromOutput: true };
  }

  const err = new Error(
    `Nie znaleziono obrazu „${raw}” w Comfy input ani output. Użyj „Z galerii” / upload — LoadImage wymaga pliku w folderze input.`
  );
  (
    err as Error & {
      friendly?: {
        message: string;
        hint: string;
        code: string;
      };
    }
  ).friendly = {
    code: "missing_start_image",
    message: `Obraz startowy „${raw}” nie istnieje w ComfyUI input.`,
    hint: "Wgraj plik albo wybierz „Z galerii” (kopiujemy do input). Sama nazwa z output (np. txt2img-flux2_…) nie wystarczy.",
  };
  throw err;
}

async function tryFetchComfyView(
  filename: string,
  subfolder: string,
  type: string
): Promise<Blob | null> {
  try {
    const url = comfyViewUrl(filename, subfolder, type);
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 32) return null;
    const ct = res.headers.get("content-type") || "image/png";
    if (ct.includes("json") || ct.includes("text")) return null;
    return new Blob([buf], { type: ct });
  } catch {
    return null;
  }
}
