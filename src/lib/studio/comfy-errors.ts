/**
 * Czytelne komunikaty PL dla typowych błędów ComfyUI / custom nodes.
 */

export type FriendlyComfyError = {
  message: string;
  hint?: string;
  linkHref?: string;
  linkLabel?: string;
  code?: string;
  /** Wieloliniowy dump node_errors do UI */
  details?: string;
  nodeErrors?: unknown;
  comfyError?: unknown;
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

function looksLikeFaceRestoreMissing(blob: string): boolean {
  return (
    /FaceRestoreCFWithModel|FaceRestoreModelLoader|facerestore_cf/i.test(
      blob
    ) &&
    (/missing_node_type|not found|No module/i.test(blob) ||
      /Custom validation failed|Value not in list/i.test(blob))
  );
}

function looksLikeLtxMissing(blob: string): boolean {
  return (
    /LTXVImgToVideo|LTXVConditioning|LTXVScheduler/i.test(blob) &&
    /missing_node_type|not found/i.test(blob)
  );
}

/** Wyciąga czytelne linie z node_errors Comfy. */
export function summarizeNodeErrors(nodeErrors: unknown): string {
  if (!nodeErrors || typeof nodeErrors !== "object") return "";
  const lines: string[] = [];
  for (const [nodeId, payload] of Object.entries(
    nodeErrors as Record<string, unknown>
  )) {
    const rec = asRecord(payload);
    const classType =
      typeof rec?.class_type === "string" ? rec.class_type : undefined;
    const errors = Array.isArray(rec?.errors) ? rec.errors : [];
    if (errors.length === 0) {
      lines.push(`node ${nodeId}${classType ? ` (${classType})` : ""}: ${JSON.stringify(payload).slice(0, 240)}`);
      continue;
    }
    for (const err of errors) {
      const e = asRecord(err);
      const type = typeof e?.type === "string" ? e.type : "";
      const message = typeof e?.message === "string" ? e.message : "";
      const details = typeof e?.details === "string" ? e.details : "";
      const bit = [type, message, details].filter(Boolean).join(" — ");
      lines.push(
        `node ${nodeId}${classType ? ` (${classType})` : ""}: ${bit || JSON.stringify(err).slice(0, 200)}`
      );
    }
  }
  return lines.join("\n");
}

function attachNodeDump(
  friendly: FriendlyComfyError,
  raw: unknown
): FriendlyComfyError {
  const rec = asRecord(raw);
  const nodeErrors = rec?.node_errors ?? rec?.nodeErrors ?? undefined;
  const comfyError = rec?.error ?? undefined;
  const details =
    friendly.details ||
    summarizeNodeErrors(nodeErrors) ||
    (typeof comfyError === "object" && comfyError
      ? JSON.stringify(comfyError)
      : undefined);
  return {
    ...friendly,
    details: details || friendly.details,
    nodeErrors: nodeErrors ?? friendly.nodeErrors,
    comfyError: comfyError ?? friendly.comfyError,
  };
}

/**
 * Mapuje surowy błąd Comfy (obiekt / JSON string / Error.message) na komunikat PL.
 * Zawsze przekazuj `{ error, node_errors }` razem.
 */
export function friendlyComfyError(raw: unknown): FriendlyComfyError {
  const parts = collectText(raw);
  const blob = parts.join("\n");
  const wrap = (f: FriendlyComfyError) => attachNodeDump(f, raw);

  if (looksLikeVhsMissing(blob)) {
    return wrap({
      code: "missing_vhs",
      message:
        "Brak Video Helper Suite na ComfyUI — node VHS_VideoCombine nie jest zainstalowany.",
      hint: VHS_HINT,
      linkHref: VHS_LINK,
      linkLabel: "ComfyUI-VideoHelperSuite (GitHub)",
    });
  }

  if (looksLikeFaceRestoreMissing(blob)) {
    return wrap({
      code: "missing_facerestore",
      message:
        "Brak face restore (facerestore_cf / CodeFormer) na ComfyUI.",
      hint: "Zainstaluj custom node facerestore_cf + models/facerestore_models/codeformer.pth, albo wyłącz toggle Face restore.",
      linkHref: "https://github.com/mav-rik/facerestore_cf",
      linkLabel: "facerestore_cf (GitHub)",
    });
  }

  if (looksLikeLtxMissing(blob)) {
    return wrap({
      code: "missing_ltx_nodes",
      message: "Brak node’ów LTXV w ComfyUI (zaktualizuj Comfy do wersji z LTXV).",
      hint: "LTXVImgToVideo / LTXVScheduler są wbudowane w nowsze ComfyUI. Zaktualizuj Comfy albo wybierz silnik SVD (draft).",
    });
  }

  const invalidImage = blob.match(/Invalid image file:\s*(.+)/i);
  if (
    invalidImage ||
    (/Value not in list/i.test(blob) && /image/i.test(blob))
  ) {
    const name =
      invalidImage?.[1]?.trim() || extractQuoted(blob) || "podany plik";
    return wrap({
      code: "invalid_start_image",
      message: `LoadImage: brak pliku „${name}” w katalogu Comfy input.`,
      hint: "Upload musi trafić do /upload/image (type=input), a do workflow idzie ta sama basename. Nazwa z output/subfolder nie przejdzie.",
    });
  }

  if (
    /CLIP.*CLIP_VISION|CLIP_VISION.*CLIP|received_type\(CLIP\).*CLIP_VISION/i.test(
      blob
    )
  ) {
    return wrap({
      code: "svd_loader_mismatch",
      message:
        "SVD wymaga ImageOnlyCheckpointLoader (CLIP_VISION) — CheckpointLoaderSimple daje CLIP i pada walidacja (także po uploadzie!).",
      hint: "Panel wymusza ImageOnlyCheckpointLoader w buildVideoWorkflow. Zrób hard refresh / poczekaj na deploy Vercel.",
    });
  }

  if (/return type mismatch|received_type.*mismatch/i.test(blob)) {
    return wrap({
      code: "type_mismatch",
      message: "Niezgodność typów połączeń w workflow Comfy.",
      hint:
        extractDetailSnippet(blob) ||
        "Sprawdź połączenia node’ów (np. CLIP vs CLIP_VISION).",
    });
  }

  const rec =
    asRecord(raw) ??
    (typeof raw === "string" ? asRecord(tryParseJson(raw)) : null);

  const validation = explainPromptValidationFailure(raw, blob);
  if (validation) return wrap(validation);

  if (rec?.type === "missing_node_type" || /missing_node_type/i.test(blob)) {
    const classType =
      (asRecord(rec?.extra_info)?.class_type as string | undefined) ||
      (typeof rec?.message === "string"
        ? rec.message.match(/Node '([^']+)'/)?.[1]
        : undefined) ||
      "nieznany";
    return wrap({
      code: "missing_node",
      message: `Brak node’a „${classType}” w ComfyUI (custom node niezaainstalowany albo zła wersja).`,
      hint: "Zainstaluj brakujący custom node w ComfyUI Manager na Legionie i zrestartuj Comfy.",
    });
  }

  if (typeof raw === "string" && raw.trim() && !raw.trim().startsWith("{")) {
    return wrap({ message: raw.trim() });
  }

  if (rec && typeof rec.message === "string" && rec.message.trim()) {
    if (/failed validation/i.test(rec.message)) {
      const nested = explainPromptValidationFailure(raw, blob);
      if (nested) return wrap(nested);
      const dump = summarizeNodeErrors(rec.node_errors ?? asRecord(raw)?.node_errors);
      return wrap({
        code: "prompt_validation",
        message: "Walidacja Comfy nie przeszła.",
        hint: dump || "Brak szczegółów node_errors — sprawdź logi Comfy na Legionie.",
        details: dump || undefined,
      });
    }
    return wrap({
      message: rec.message.trim(),
      hint: typeof rec.details === "string" ? rec.details : undefined,
    });
  }

  if (raw instanceof Error && raw.message) {
    const nested = tryParseJson(raw.message);
    if (nested) return friendlyComfyError(nested);
    return wrap({ message: raw.message });
  }

  const fallback = parts.find((p) => p.length > 0 && p.length < 400);
  return wrap({
    message: fallback || "Błąd ComfyUI — sprawdź logi na Legionie.",
  });
}

export function formatFriendlyErrorLines(err: FriendlyComfyError): string {
  return [err.message, err.hint, err.details].filter(Boolean).join(" ");
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
  return lines.find((l) =>
    /mismatch|invalid|video_frames|width|height|image/i.test(l)
  );
}

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

  const dump = summarizeNodeErrors(asRecord(raw)?.node_errors);

  if (
    /Invalid image file/i.test(blob) ||
    (/Value not in list/i.test(blob) && /image/i.test(blob))
  ) {
    const name =
      blob.match(/Invalid image file:\s*(.+)/i)?.[1]?.trim() ||
      extractQuoted(blob) ||
      "…";
    return {
      code: "invalid_start_image",
      message: `LoadImage: nieprawidłowy / brakujący plik „${name}” w input.`,
      hint: "Upload → Comfy /upload/image (input). Do LoadImage idzie basename z odpowiedzi uploadu.",
      details: dump || undefined,
    };
  }

  if (/CLIP|CLIP_VISION/i.test(blob)) {
    return {
      code: "svd_loader_mismatch",
      message:
        "Walidacja: CLIP ≠ CLIP_VISION — użyj ImageOnlyCheckpointLoader dla SVD.",
      hint: dump || undefined,
      details: dump || undefined,
    };
  }

  return {
    code: "prompt_validation",
    message: "Walidacja Comfy nie przeszła (Prompt outputs failed validation).",
    hint:
      dump ||
      "Częste przyczyny: CheckpointLoaderSimple zamiast ImageOnlyCheckpointLoader, albo zła nazwa LoadImage.",
    details: dump || undefined,
  };
}
