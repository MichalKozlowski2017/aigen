import { fetchComfyViewBlob, uploadImageToComfy } from "./comfy-client";

export type StartImageSource = {
  filename: string;
  subfolder?: string;
  type?: "input" | "output" | "temp" | string;
};

/**
 * LoadImage waliduje wyłącznie pliki w ComfyUI **input** (basename).
 * Galeria / SaveImage zapisuje do **output** (np. studio/txt2img-flux2_00003_.png)
 * → bez kopii: „Invalid image file” / „Prompt outputs failed validation”.
 *
 * Zawsze pobieramy bajty i **force-upload** do input/ (overwrite) — nie ufamy
 * samej obecności nazwy w polu formularza.
 */
export async function ensureStartImageInComfyInput(
  startImage: string,
  source?: StartImageSource | null
): Promise<{ startImage: string; copiedFromOutput: boolean; sourceUsed: string }> {
  const raw = startImage.trim();
  if (!raw && !source?.filename) {
    throw missingStartError("(puste)");
  }

  const candidates = buildCandidates(raw, source);
  let lastBlob: Blob | null = null;
  let lastKey = "";
  let fromOutput = false;

  for (const c of candidates) {
    const key = `${c.type}:${c.subfolder}/${c.filename}`;
    const blob = await fetchComfyViewBlob(c.filename, c.subfolder, c.type);
    if (!blob) continue;
    lastBlob = blob;
    lastKey = key;
    fromOutput = c.type !== "input";
    // Prefer explicit / output hits — still force-upload below
    break;
  }

  if (!lastBlob) {
    throw missingStartError(raw || source?.filename || "?");
  }

  const basename = sanitizeBasename(
    source?.filename || (raw.includes("/") ? raw.slice(raw.lastIndexOf("/") + 1) : raw)
  );

  const uploaded = await uploadImageToComfy(lastBlob, basename, {
    overwrite: true,
    // Zawsze root input — LoadImage combo to top-level listdir
  });

  // Nigdy nie zwracaj ścieżki z subfolderem do LoadImage
  const name = uploaded.name;
  return {
    startImage: name,
    copiedFromOutput: fromOutput,
    sourceUsed: lastKey,
  };
}

function buildCandidates(
  raw: string,
  source?: StartImageSource | null
): Array<{ filename: string; subfolder: string; type: string }> {
  const out: Array<{ filename: string; subfolder: string; type: string }> = [];
  const push = (filename: string, subfolder: string, type: string) => {
    if (!filename) return;
    out.push({ filename, subfolder, type });
  };

  if (source?.filename) {
    const t = source.type || "output";
    const sub = source.subfolder || "";
    push(source.filename, sub, t);
    // Also try flipped type if explicit miss
    if (t !== "input") push(source.filename, sub, "input");
    if (t !== "output") push(source.filename, sub, "output");
    if (sub) {
      push(source.filename, "", t);
      push(source.filename, "", "output");
      push(source.filename, "", "input");
    }
  }

  if (raw.includes("/")) {
    const i = raw.lastIndexOf("/");
    const sub = raw.slice(0, i);
    const file = raw.slice(i + 1);
    push(file, sub, "output");
    push(file, sub, "input");
    push(file, "", "input");
    push(file, "", "output");
  } else if (raw) {
    // Typowe prefixy SaveImage Studio: studio/txt2img-flux2_…
    push(raw, "", "input");
    push(raw, "", "output");
    push(raw, "studio", "output");
    push(raw, "studio", "input");
  }

  // Dedup
  const seen = new Set<string>();
  return out.filter((c) => {
    const k = `${c.type}:${c.subfolder}/${c.filename}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function sanitizeBasename(name: string): string {
  const base =
    name.replace(/[^\w.\-]+/g, "_").replace(/^\.+/, "") || "start.png";
  return base.length > 180 ? base.slice(-180) : base;
}

function missingStartError(label: string): Error {
  const err = new Error(
    `Nie znaleziono obrazu „${label}” w Comfy input/output. Użyj „Z galerii” / upload.`
  );
  (
    err as Error & {
      friendly?: { message: string; hint: string; code: string };
    }
  ).friendly = {
    code: "missing_start_image",
    message: `Obraz startowy „${label}” nie istnieje w ComfyUI input ani output.`,
    hint: "Wgraj plik albo „Z galerii”. Sama nazwa z output bez kopii do input powoduje „Prompt outputs failed validation” (LoadImage).",
  };
  return err;
}
