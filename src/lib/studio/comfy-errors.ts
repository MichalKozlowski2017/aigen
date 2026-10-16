/**
 * Czytelne komunikaty PL dla typowych błędów ComfyUI / custom nodes.
 */

export type FriendlyComfyError = {
  message: string;
  hint?: string;
  linkHref?: string;
  linkLabel?: string;
  code?: string;
};

const VHS_HINT =
  "Zainstaluj custom node Video Helper Suite (VHS) na Legionie w ComfyUI Manager albo z GitHub, potem zrestartuj ComfyUI.";
const VHS_LINK =
  "https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function tryParseJson(text: string): unknown {
  const t = text.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return null;
  try {
    return JSON.parse(t) as unknown;
  } catch {
    return null;
  }
}

function collectText(value: unknown, acc: string[] = []): string[] {
  if (value == null) return acc;
  if (typeof value === "string") {
    acc.push(value);
    const nested = tryParseJson(value);
    if (nested) collectText(nested, acc);
    return acc;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    acc.push(String(value));
    return acc;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, acc);
    return acc;
  }
  const rec = asRecord(value);
  if (!rec) return acc;
  for (const v of Object.values(rec)) collectText(v, acc);
  return acc;
}

function looksLikeVhsMissing(blob: string): boolean {
  return (
    /VHS_VideoCombine/i.test(blob) ||
    (/Video Helper Suite/i.test(blob) && /not found|missing/i.test(blob)) ||
    (/missing_node_type/i.test(blob) && /VHS_/i.test(blob))
  );
}

/**
 * Mapuje surowy błąd Comfy (obiekt / JSON string / Error.message) na komunikat PL.
 * Ważne: przekazuj razem `error` + `node_errors` — sam top-level message często
 * to tylko „Prompt outputs failed validation”.
 */
export function friendlyComfyError(raw: unknown): FriendlyComfyError {
  const parts = collectText(raw);
  const blob = parts.join("\n");

  if (looksLikeVhsMissing(blob)) {
    return {
      code: "missing_vhs",
      message:
        "Brak Video Helper Suite na ComfyUI — node VHS_VideoCombine nie jest zainstalowany.",
      hint: VHS_HINT,
      linkHref: VHS_LINK,
      linkLabel: "ComfyUI-VideoHelperSuite (GitHub)",
    };
  }

  const invalidImage = blob.match(/Invalid image file:\s*(.+)/i);
  if (
    invalidImage ||
    (/Value not in list/i.test(blob) && /image/i.test(blob))
  ) {
    const name = invalidImage?.[1]?.trim() || extractQuoted(blob) || "podany plik";
    return {
      code: "invalid_start_image",
      message: `LoadImage: brak pliku „${name}” w katalogu Comfy input.`,
      hint: "Wgraj obraz albo użyj „Z galerii” (kopiujemy do input). Nazwa z output (np. txt2img-flux2_…) sama nie wystarczy — stąd „Prompt outputs failed validation”.",
    };
  }

  if (/return type mismatch|received_type.*mismatch/i.test(blob)) {
    return {
      code: "type_mismatch",
      message: "Niezgodność typów połączeń w workflow Comfy.",
      hint: extractDetailSnippet(blob) ||
        "Sprawdź czy checkpoint SVD wystawia CLIP_VISION, a VHS przyjmuje frame_rate (INT/FLOAT).",
    };
  }

  const rec =
    asRecord(raw) ??
    (typeof raw === "string" ? asRecord(tryParseJson(raw)) : null);

  const validation = explainPromptValidationFailure(raw, blob);
  if (validation) return validation;

  if (rec?.type === "missing_node_type" || /missing_node_type/i.test(blob)) {
    const classType =
      (asRecord(rec?.extra_info)?.class_type as string | undefined) ||
      (typeof rec?.message === "string"
        ? rec.message.match(/Node '([^']+)'/)?.[1]
        : undefined) ||
      "nieznany";
    return {
      code: "missing_node",
      message: `Brak node’a „${classType}” w ComfyUI (custom node niezaainstalowany albo zła wersja).`,
      hint: "Zainstaluj brakujący custom node w ComfyUI Manager na Legionie i zrestartuj Comfy.",
    };
  }

  if (typeof raw === "string" && raw.trim() && !raw.trim().startsWith("{")) {
    return { message: raw.trim() };
  }

  if (rec && typeof rec.message === "string" && rec.message.trim()) {
    // Jeśli to ogólne „failed validation” bez szczegółów — spróbuj node_errors w tym samym raw
    if (/failed validation/i.test(rec.message) && asRecord(raw)?.node_errors) {
      const nested = explainPromptValidationFailure(raw, blob);
      if (nested) return nested;
    }
    return {
      message: rec.message.trim(),
      hint: typeof rec.details === "string" ? rec.details : undefined,
    };
  }

  if (raw instanceof Error && raw.message) {
    const nested = tryParseJson(raw.message);
    if (nested) return friendlyComfyError(nested);
    return { message: raw.message };
  }

  const fallback = parts.find((p) => p.length > 0 && p.length < 400);
  return {
    message: fallback || "Błąd ComfyUI — sprawdź logi na Legionie.",
  };
}

export function formatFriendlyErrorLines(err: FriendlyComfyError): string {
  return [err.message, err.hint].filter(Boolean).join(" ");
}

function extractQuoted(blob: string): string | null {
  const m = blob.match(/['"]([^'"]+\.(?:png|jpe?g|webp|gif))['"]/i);
  return m?.[1] ?? null;
}

function extractDetailSnippet(blob: string): string | undefined {
  const lines = blob
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 8 && l.length < 220);
  return lines.find((l) => /mismatch|invalid|video_frames|width|height|image/i.test(l));
}

/**
 * Comfy często zwraca tylko „Prompt outputs failed validation” —
 * wyciągamy z node_errors konkretne pola (image, video_frames, width, height…).
 */
function explainPromptValidationFailure(
  raw: unknown,
  blob: string
): FriendlyComfyError | null {
  const isValidation =
    /prompt outputs failed validation/i.test(blob) ||
    /failed_validation|prompt_outputs_failed_validation|custom_validation_failed|Value not in list/i.test(
      blob
    );
  if (!isValidation) return null;

  if (/Invalid image file/i.test(blob) || (/Value not in list/i.test(blob) && /image/i.test(blob))) {
    const name = blob.match(/Invalid image file:\s*(.+)/i)?.[1]?.trim() ||
      extractQuoted(blob) ||
      "…";
    return {
      code: "invalid_start_image",
      message: `LoadImage: nieprawidłowy / brakujący plik „${name}” w input.`,
      hint: "Użyj uploadu lub „Z galerii”. Pliki z output Comfy nie są widoczne dla LoadImage bez skopiowania do input.",
    };
  }

  const fieldHits: string[] = [];
  const detailBits: string[] = [];
  const nodeHints: string[] = [];

  const scan = (value: unknown, path = "") => {
    if (!value) return;
    if (typeof value === "string") {
      if (/video_frames/i.test(value)) fieldHits.push("video_frames");
      if (/\bwidth\b/i.test(value)) fieldHits.push("width");
      if (/\bheight\b/i.test(value)) fieldHits.push("height");
      if (/\bfps\b/i.test(value) || /frame_rate/i.test(value)) fieldHits.push("fps/frame_rate");
      if (/\bimage\b/i.test(value)) fieldHits.push("image");
      if (
        value.length < 280 &&
        (/must be|max|min|between|invalid|<=|>=|not in list|mismatch/i.test(value) ||
          /video_frames|width|height|image/i.test(value))
      ) {
        detailBits.push(value);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) scan(item, path);
      return;
    }
    const obj = asRecord(value);
    if (!obj) return;
    if (typeof obj.class_type === "string") {
      nodeHints.push(obj.class_type);
    }
    if (typeof obj.details === "string") scan(obj.details, path);
    if (typeof obj.message === "string") scan(obj.message, path);
    for (const [k, v] of Object.entries(obj)) {
      if (/video_frames|width|height|fps|frame_rate|image/i.test(k)) {
        fieldHits.push(k);
      }
      scan(v, path ? `${path}.${k}` : k);
    }
  };

  scan(raw);

  const uniqueFields = Array.from(new Set(fieldHits));
  const uniqueDetails = Array.from(new Set(detailBits)).slice(0, 4);
  const nodes = Array.from(new Set(nodeHints)).slice(0, 3);

  if (uniqueFields.includes("image") || nodes.includes("LoadImage")) {
    return {
      code: "invalid_start_image",
      message: "Walidacja LoadImage nie przeszła (obraz startowy).",
      hint:
        uniqueDetails.join(" · ") ||
        "Plik musi istnieć w ComfyUI/input — wgraj go lub wybierz z galerii (auto-kopia).",
    };
  }

  return {
    code: "prompt_validation",
    message: uniqueFields.length
      ? `Walidacja Comfy nie przeszła — pola: ${uniqueFields.join(", ")}${nodes.length ? ` (nody: ${nodes.join(", ")})` : ""}.`
      : "Walidacja Comfy nie przeszła (Prompt outputs failed validation).",
    hint:
      uniqueDetails.join(" · ") ||
      "Częste przyczyny: brak pliku w input (LoadImage), zły typ połączenia, albo wartość poza min/max widgetu.",
  };
}
