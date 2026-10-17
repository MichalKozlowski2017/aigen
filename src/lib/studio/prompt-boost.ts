/**
 * PL → EN + lekki boost pod SDXL / SVD / Wan.
 * Bez płatnego klucza: MyMemory (public). Opcjonalnie LibreTranslate (self-host)
 * lub OpenAI, gdy jest OPENAI_API_KEY. Translate fail → oryginał + warning.
 * Wideo: guard static camera / medium shot + negatyw (hands / zoom / shake).
 */

import {
  DEFAULT_WAN_NEGATIVE,
  VIDEO_CAMERA_GUARD,
} from "./defaults";

export type PromptBoostKind = "image" | "video";

export type PromptBoostResult = {
  /** Tekst wysyłany do modelu (EN + boost). */
  modelPrompt: string;
  /** Negatyw po ewentualnym tłumaczeniu (bez quality-boost). */
  modelNegative: string;
  /** Oryginał z UI. */
  originalPrompt: string;
  originalNegative: string;
  translated: boolean;
  negativeTranslated: boolean;
  boosted: boolean;
  detectedPolish: boolean;
  provider: "none" | "passthrough" | "mymemory" | "libretranslate" | "openai";
  warnings: string[];
};

const PL_DIACRITICS = /[ąćęłńóśźż]/i;

/** Typowe tokeny PL (także bez polskich znaków — „slonca”, „mezczyzna”). */
const PL_HINT_WORDS = new Set([
  "kobieta",
  "mezczyzna",
  "mężczyzna",
  "dziewczyna",
  "chlopak",
  "chłopak",
  "biegnie",
  "biegną",
  "biegna",
  "stoi",
  "siedzi",
  "idzie",
  "zachodzie",
  "wschodzie",
  "slonca",
  "słońca",
  "ksiezyca",
  "księżyca",
  "pustyni",
  "asfalcie",
  "ulicy",
  "lesie",
  "morzu",
  "jeziorze",
  "gorach",
  "górach",
  "wieczorem",
  "rano",
  "noca",
  "nocą",
  "legginsach",
  "sukience",
  "kurtce",
  "kapeluszu",
  "portrecie",
  "krajobraz",
  "zdjecie",
  "zdjęcie",
  "fotorealistyczny",
  "realistyczny",
  "piękna",
  "piekna",
  "mloda",
  "młoda",
  "stara",
  "duzy",
  "duży",
  "maly",
  "mały",
]);

const IMAGE_QUALITY_SUFFIX =
  "photorealistic, natural lighting, sharp focus, detailed skin texture, cinematic composition";

const VIDEO_QUALITY_SUFFIX =
  "smooth natural motion, photorealistic";

const ALREADY_HAS_QUALITY =
  /\b(photorealistic|photo[\s-]?realistic|8k|raw photo|sharp focus|cinematic)\b/i;

const HAS_CAMERA_GUARD =
  /\b(static camera|locked.?off|fixed camera|medium shot|medium close.?up)\b/i;

export function looksPolish(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (PL_DIACRITICS.test(trimmed)) return true;

  const tokens =
    trimmed
      .toLowerCase()
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .match(/[a-z0-9]+/gi) ?? [];

  let hits = 0;
  for (const t of tokens) {
    if (PL_HINT_WORDS.has(t)) hits += 1;
  }
  // Krótki opis sceny po PL bez ogonków (np. „Kobieta … na pustyni”)
  return hits >= 2 || (hits >= 1 && tokens.length <= 16);
}

function shouldAlwaysTranslate(): boolean {
  const v = process.env.PROMPT_BOOST_ALWAYS_TRANSLATE?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function chunkForMyMemory(text: string, maxLen = 450): string[] {
  if (text.length <= maxLen) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf(" ", maxLen);
    if (cut < maxLen * 0.4) cut = maxLen;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

async function translateMyMemory(text: string): Promise<string> {
  const chunks = chunkForMyMemory(text);
  const out: string[] = [];
  for (const chunk of chunks) {
    const url = new URL("https://api.mymemory.translated.net/get");
    url.searchParams.set("q", chunk);
    url.searchParams.set("langpair", "pl|en");
    const email = process.env.MYMEMORY_EMAIL?.trim();
    if (email) url.searchParams.set("de", email);

    const res = await fetch(url.toString(), {
      method: "GET",
      signal: AbortSignal.timeout(12_000),
      next: { revalidate: 0 },
    });
    if (!res.ok) {
      throw new Error(`MyMemory HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      responseStatus?: number | string;
      responseData?: { translatedText?: string };
      responseDetails?: string;
    };
    const status = Number(data.responseStatus);
    if (status !== 200 || !data.responseData?.translatedText) {
      throw new Error(
        data.responseDetails || `MyMemory status ${data.responseStatus}`
      );
    }
    out.push(data.responseData.translatedText.trim());
  }
  return out.join(" ").trim();
}

async function translateLibre(text: string): Promise<string> {
  const base =
    process.env.LIBRETRANSLATE_URL?.trim().replace(/\/$/, "") ||
    "https://libretranslate.com";
  const apiKey = process.env.LIBRETRANSLATE_API_KEY?.trim();
  const body: Record<string, string> = {
    q: text,
    source: "pl",
    target: "en",
    format: "text",
  };
  if (apiKey) body.api_key = apiKey;

  const res = await fetch(`${base}/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    throw new Error(`LibreTranslate HTTP ${res.status}`);
  }
  const data = (await res.json()) as { translatedText?: string; error?: string };
  if (data.error || !data.translatedText?.trim()) {
    throw new Error(data.error || "LibreTranslate empty");
  }
  return data.translatedText.trim();
}

async function translateOpenAI(text: string, kind: PromptBoostKind): Promise<string> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_API_KEY missing");

  const model = process.env.OPENAI_PROMPT_MODEL?.trim() || "gpt-4o-mini";
  const role =
    kind === "video"
      ? "video motion / atmosphere prompt for Stable Video Diffusion"
      : "photorealistic image prompt for Stable Diffusion XL";

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            `You translate Polish user prompts into concise English ${role}. ` +
            "Keep the same meaning and concrete details. Do not add new subjects or story. " +
            "Output only the English prompt, no quotes or commentary.",
        },
        { role: "user", content: text },
      ],
    }),
    signal: AbortSignal.timeout(20_000),
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenAI HTTP ${res.status}: ${errText.slice(0, 120)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("OpenAI empty");
  return content.replace(/^["']|["']$/g, "").trim();
}

export type TranslateOutcome = {
  text: string;
  translated: boolean;
  provider: PromptBoostResult["provider"];
  warning?: string;
};

/**
 * Tłumaczy PL→EN. Kolejność: OpenAI (jeśli klucz) → LibreTranslate (jeśli URL/klucz)
 * → MyMemory. Błąd → oryginał + warning.
 */
export async function translatePlToEn(
  text: string,
  kind: PromptBoostKind = "image"
): Promise<TranslateOutcome> {
  const trimmed = text.trim();
  if (!trimmed) {
    return { text: "", translated: false, provider: "none" };
  }

  const preferOpenAI = Boolean(process.env.OPENAI_API_KEY?.trim());
  const preferLibre = Boolean(
    process.env.LIBRETRANSLATE_URL?.trim() ||
      process.env.LIBRETRANSLATE_API_KEY?.trim()
  );

  const attempts: Array<() => Promise<{ text: string; provider: PromptBoostResult["provider"] }>> =
    [];

  if (preferOpenAI) {
    attempts.push(async () => ({
      text: await translateOpenAI(trimmed, kind),
      provider: "openai",
    }));
  }
  if (preferLibre) {
    attempts.push(async () => ({
      text: await translateLibre(trimmed),
      provider: "libretranslate",
    }));
  }
  attempts.push(async () => ({
    text: await translateMyMemory(trimmed),
    provider: "mymemory",
  }));

  const errors: string[] = [];
  for (const run of attempts) {
    try {
      const result = await run();
      if (!result.text.trim()) continue;
      return {
        text: result.text.trim(),
        translated: result.text.trim() !== trimmed,
        provider: result.provider,
      };
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return {
    text: trimmed,
    translated: false,
    provider: "passthrough",
    warning: `Tłumaczenie niedostępne — używam oryginału. (${errors[0] ?? "unknown"})`,
  };
}

function appendQualityBoost(
  englishPrompt: string,
  kind: PromptBoostKind
): { text: string; boosted: boolean } {
  const base = englishPrompt.trim().replace(/,+\s*$/, "");
  if (!base) return { text: "", boosted: false };
  if (ALREADY_HAS_QUALITY.test(base)) {
    return { text: base, boosted: false };
  }
  const suffix = kind === "video" ? VIDEO_QUALITY_SUFFIX : IMAGE_QUALITY_SUFFIX;
  return { text: `${base}, ${suffix}`, boosted: true };
}

/** Dopisz static camera + medium shot, jeśli brak w prompcie. */
function appendVideoCameraGuard(prompt: string): {
  text: string;
  guarded: boolean;
} {
  const base = prompt.trim().replace(/,+\s*$/, "");
  if (!base) return { text: "", guarded: false };
  if (HAS_CAMERA_GUARD.test(base)) {
    return { text: base, guarded: false };
  }
  return { text: `${base}, ${VIDEO_CAMERA_GUARD}`, guarded: true };
}

/** Scal negatyw usera z DEFAULT_WAN_NEGATIVE (bez duplikatów tokenów). */
export function mergeWanNegative(userNegative: string): string {
  const user = userNegative.trim();
  if (!user) return DEFAULT_WAN_NEGATIVE;
  const seen = new Set(
    user
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
  );
  const extras = DEFAULT_WAN_NEGATIVE.split(",")
    .map((t) => t.trim())
    .filter((t) => t && !seen.has(t.toLowerCase()));
  if (extras.length === 0) return user;
  return `${user}, ${extras.join(", ")}`;
}

export type PreparePromptInput = {
  prompt: string;
  negativePrompt?: string;
  kind?: PromptBoostKind;
  /** Wymuś próbę tłumaczenia nawet bez detekcji PL. */
  forceTranslate?: boolean;
};

/**
 * Przygotowuje prompt (i negatyw) pod SDXL/SVD: detekcja PL → EN + lekki boost.
 */
export async function preparePromptForModel(
  input: PreparePromptInput
): Promise<PromptBoostResult> {
  const kind = input.kind ?? "image";
  const originalPrompt = input.prompt ?? "";
  const originalNegative = input.negativePrompt ?? "";
  const warnings: string[] = [];

  const detectedPolish = looksPolish(originalPrompt);
  const force =
    input.forceTranslate === true || shouldAlwaysTranslate();

  let modelPrompt = originalPrompt.trim();
  let translated = false;
  let provider: PromptBoostResult["provider"] = "passthrough";

  if (modelPrompt && (detectedPolish || force)) {
    const outcome = await translatePlToEn(modelPrompt, kind);
    modelPrompt = outcome.text;
    translated = outcome.translated;
    provider = outcome.provider;
    if (outcome.warning) warnings.push(outcome.warning);
  } else if (!modelPrompt) {
    provider = "none";
  }

  const { text: boostedPrompt, boosted } = appendQualityBoost(modelPrompt, kind);
  modelPrompt = boostedPrompt;

  if (kind === "video") {
    const guarded = appendVideoCameraGuard(modelPrompt);
    modelPrompt = guarded.text;
  }

  let modelNegative = originalNegative.trim();
  let negativeTranslated = false;
  if (modelNegative && (looksPolish(modelNegative) || force)) {
    const negOut = await translatePlToEn(modelNegative, kind);
    modelNegative = negOut.text;
    negativeTranslated = negOut.translated;
    if (negOut.warning) {
      warnings.push(`Negatyw: ${negOut.warning}`);
    }
    if (negOut.provider !== "passthrough" && negOut.provider !== "none") {
      // Zachowaj główny provider z pozytywnego, chyba że nie było tłumaczenia promptu
      if (provider === "passthrough" || provider === "none") {
        provider = negOut.provider;
      }
    }
  }

  if (kind === "video") {
    modelNegative = mergeWanNegative(modelNegative);
  }

  return {
    modelPrompt,
    modelNegative,
    originalPrompt,
    originalNegative,
    translated,
    negativeTranslated,
    boosted,
    detectedPolish,
    provider,
    warnings,
  };
}
