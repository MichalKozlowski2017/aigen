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

  const rec =
    asRecord(raw) ??
    (typeof raw === "string" ? asRecord(tryParseJson(raw)) : null);

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
    return { message: rec.message.trim(), hint: typeof rec.details === "string" ? rec.details : undefined };
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
