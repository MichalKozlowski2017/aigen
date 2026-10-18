/**
 * Czytelne komunikaty PL dla typowych błędów ComfyUI / custom nodes.
 *
 * Ważne: Wan I2V ma zarówno CLIPLoader jak i CLIPVisionLoader — samo „CLIP”
 * w node_errors NIE oznacza błędu SVD / ImageOnlyCheckpointLoader.
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

export type FriendlyComfyErrorContext = {
  /** Silnik Studio (gdy znany) — nie zgaduj SVD przy Wan/LTX. */
  engine?: string;
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

function looksLikeRifeMissing(blob: string): boolean {
  return (
    /RIFE VFI|Frame.Interpolation|rife\d+\.pth/i.test(blob) &&
    /missing_node_type|not found|No module|Value not in list/i.test(blob)
  );
}

function looksLikeUpscaleMissing(blob: string): boolean {
  return (
    /UpscaleModelLoader|ImageUpscaleWithModel|RealESRGAN/i.test(blob) &&
    /missing_node_type|not found|No module|Value not in list/i.test(blob)
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

/** True gdy dump wygląda na SVD (nie Wan CLIPLoader + CLIPVisionLoader). */
function looksLikeSvdLoaderContext(blob: string, ctx?: FriendlyComfyErrorContext): boolean {
  if (ctx?.engine === "svd") return true;
  if (ctx?.engine === "wan" || ctx?.engine === "ltx" || ctx?.engine === "flux") {
    return false;
  }
  return (
    /SVD_img2vid|ImageOnlyCheckpointLoader|svd_xt/i.test(blob) ||
    (/CheckpointLoaderSimple/i.test(blob) &&
      /CLIP_VISION/i.test(blob) &&
      !/CLIPVisionLoader|WanImageToVideo|UNETLoader/i.test(blob))
  );
}

/**
 * Prawdziwy return_type_mismatch CLIP ↔ CLIP_VISION.
 * Nie triggeruj na samym class_type „CLIPLoader” / „CLIPVisionLoader” (Wan ma oba).
 * CLIP_VISION_OUTPUT (Wan) ≠ para CLIP/CLIP_VISION (SVD).
 */
function looksLikeClipVisionTypeMismatch(blob: string): boolean {
  // Isoluj typowe frazy Comfy: "CLIP, CLIP_VISION" / "CLIP != CLIP_VISION" / received_type(CLIP)
  const pair =
    /\bCLIP\s*,\s*CLIP_VISION\b|\bCLIP_VISION\s*,\s*CLIP\b|\bCLIP\s*!=\s*CLIP_VISION\b|\bCLIP_VISION\s*!=\s*CLIP\b|received_type\s*\(\s*CLIP\s*\).*CLIP_VISION|received_type\s*\(\s*CLIP_VISION\s*\).*\bCLIP\b/i.test(
      blob
    );
  if (!pair) return false;
  // Samo CLIP_VISION_OUTPUT bez pary CLIP↔CLIP_VISION — nie SVD
  if (/CLIP_VISION_OUTPUT/i.test(blob) && !/\bCLIP\s*,\s*CLIP_VISION\b|\bCLIP\s*!=\s*CLIP_VISION\b/i.test(blob)) {
    return false;
  }
  return true;
}

function clipVisionMismatchFriendly(
  blob: string,
  dump: string,
  ctx?: FriendlyComfyErrorContext
): FriendlyComfyError {
  if (looksLikeSvdLoaderContext(blob, ctx)) {
    return {
      code: "svd_loader_mismatch",
      message:
        "SVD wymaga ImageOnlyCheckpointLoader (CLIP_VISION) — CheckpointLoaderSimple daje CLIP i pada walidacja.",
      hint:
        dump ||
        "Panel wymusza ImageOnlyCheckpointLoader w buildSvdVideoWorkflow.",
      details: dump || undefined,
    };
  }
  return {
    code: "type_mismatch",
    message: "Niezgodność typów CLIP / CLIP_VISION w workflow Comfy.",
    hint:
      dump ||
      extractDetailSnippet(blob) ||
      "To nie jest automatycznie błąd SVD — sprawdź node_errors poniżej (Wan używa CLIPLoader + CLIPVisionLoader).",
    details: dump || undefined,
  };
}

/**
 * Mapuje surowy błąd Comfy (obiekt / JSON string / Error.message) na komunikat PL.
 * Zawsze przekazuj `{ error, node_errors }` razem.
 */
export function friendlyComfyError(
  raw: unknown,
  ctx?: FriendlyComfyErrorContext
): FriendlyComfyError {
  const parts = collectText(raw);
  const blob = parts.join("\n");
  const wrap = (f: FriendlyComfyError) => attachNodeDump(f, raw);
  const dump = summarizeNodeErrors(asRecord(raw)?.node_errors);

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

  if (looksLikeRifeMissing(blob)) {
    return wrap({
      code: "missing_rife",
      message: "Brak RIFE (ComfyUI-Frame-Interpolation) na ComfyUI.",
      hint: "Zainstaluj ComfyUI-Frame-Interpolation + wagi rife47.pth, albo wyłącz Smooth 24 / postRife — pipeline i tak zwróci stitch @16 fps.",
      linkHref: "https://github.com/Fannovel16/ComfyUI-Frame-Interpolation",
      linkLabel: "ComfyUI-Frame-Interpolation (GitHub)",
    });
  }

  if (looksLikeUpscaleMissing(blob)) {
    return wrap({
      code: "missing_upscale",
      message: "Brak modelu / node’ów upscale (RealESRGAN) na ComfyUI.",
      hint: "Zainstaluj UpscaleModelLoader + RealESRGAN_x2plus.pth, albo wyłącz postUpscale.",
    });
  }

  const invalidImage = blob.match(/Invalid image file:\s*(.+)/i);
  if (
    invalidImage ||
    (/Value not in list/i.test(blob) && /\bimage\b/i.test(blob) && /LoadImage/i.test(blob))
  ) {
    const name =
      invalidImage?.[1]?.trim() || extractQuoted(blob) || "podany plik";
    return wrap({
      code: "invalid_start_image",
      message: `LoadImage: brak pliku „${name}” w katalogu Comfy input.`,
      hint: "Upload musi trafić do /upload/image (type=input), a do workflow idzie ta sama basename. Nazwa z output/subfolder nie przejdzie.",
    });
  }

  // CLIP ↔ CLIP_VISION: tylko przy prawdziwym type mismatch — i SVD hint tylko gdy kontekst SVD.
  if (looksLikeClipVisionTypeMismatch(blob)) {
    return wrap(clipVisionMismatchFriendly(blob, dump, ctx));
  }

  if (/return type mismatch|received_type.*mismatch/i.test(blob)) {
    return wrap({
      code: "type_mismatch",
      message: "Niezgodność typów połączeń w workflow Comfy.",
      hint:
        dump ||
        extractDetailSnippet(blob) ||
        "Sprawdź połączenia node’ów (szczegóły w node_errors).",
      details: dump || undefined,
    });
  }

  const rec =
    asRecord(raw) ??
    (typeof raw === "string" ? asRecord(tryParseJson(raw)) : null);

  // missing_node przed ogólną walidacją — nie maskuj przez CLIPLoader w dumpie.
  if (rec?.type === "missing_node_type" || /missing_node_type/i.test(blob)) {
    const classType =
      (asRecord(rec?.extra_info)?.class_type as string | undefined) ||
      (typeof rec?.message === "string"
        ? rec.message.match(/Node '([^']+)'/)?.[1]
        : undefined) ||
      blob.match(/Node '([^']+)'/)?.[1] ||
      "nieznany";
    return wrap({
      code: "missing_node",
      message: `Brak node’a „${classType}” w ComfyUI (custom node niezaainstalowany albo zła wersja).`,
      hint:
        dump ||
        "Zainstaluj brakujący custom node w ComfyUI Manager na Legionie i zrestartuj Comfy.",
      details: dump || undefined,
    });
  }

  const validation = explainPromptValidationFailure(raw, blob, ctx);
  if (validation) return wrap(validation);

  if (typeof raw === "string" && raw.trim() && !raw.trim().startsWith("{")) {
    return wrap({ message: raw.trim() });
  }

  if (rec && typeof rec.message === "string" && rec.message.trim()) {
    if (/failed validation/i.test(rec.message)) {
      const nested = explainPromptValidationFailure(raw, blob, ctx);
      if (nested) return wrap(nested);
      return wrap({
        code: "prompt_validation",
        message: dump
          ? `Walidacja Comfy nie przeszła: ${dump.split("\n")[0]}`
          : "Walidacja Comfy nie przeszła.",
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
    if (nested) return friendlyComfyError(nested, ctx);
    return wrap({ message: raw.message });
  }

  const fallback = parts.find((p) => p.length > 0 && p.length < 400);
  return wrap({
    message: fallback || "Błąd ComfyUI — sprawdź logi na Legionie.",
  });
}

export function formatFriendlyErrorLines(err: FriendlyComfyError): string {
  // Preferuj szczegóły node_errors gdy message jest ogólny
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
  blob: string,
  ctx?: FriendlyComfyErrorContext
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
    (/Value not in list/i.test(blob) && /LoadImage|\bimage\b/i.test(blob))
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

  // NIE mapuj samego „CLIPLoader” / „CLIPVisionLoader” na SVD — Wan ma oba.
  if (looksLikeClipVisionTypeMismatch(blob)) {
    return clipVisionMismatchFriendly(blob, dump, ctx);
  }

  const firstLine = dump.split("\n").find((l) => l.trim().length > 0);
  return {
    code: "prompt_validation",
    message: firstLine
      ? `Walidacja Comfy nie przeszła: ${firstLine}`
      : "Walidacja Comfy nie przeszła (Prompt outputs failed validation).",
    hint:
      dump ||
      "Sprawdź node_errors w logach Comfy na Legionie (częste: zła nazwa modelu / brak custom node).",
    details: dump || undefined,
  };
}
