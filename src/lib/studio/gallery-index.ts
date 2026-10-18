import {
  fetchComfyViewText,
  uploadFileToComfy,
} from "./comfy-client";
import { normalizeComfyMediaRef, type ComfyMediaRef } from "./comfy-media";

/** Trwały indeks galerii w Comfy `input/` — przeżywa wipe `/history` po restarcie. */
export const GALLERY_INDEX_FILENAME = "aigen-gallery-index.json";
const GALLERY_INDEX_MAX = 200;
const INDEX_VERSION = 1;

export type GalleryIndexEntry = ComfyMediaRef & {
  mtimeMs?: number;
};

type GalleryIndexFile = {
  version: number;
  updatedAt: number;
  items: GalleryIndexEntry[];
};

function entryKey(e: ComfyMediaRef): string {
  return `${e.type}/${e.subfolder}/${e.filename}`;
}

function normalizeEntry(
  raw: Partial<GalleryIndexEntry> | null | undefined
): GalleryIndexEntry | null {
  if (!raw?.filename || typeof raw.filename !== "string") return null;
  const ref = normalizeComfyMediaRef(
    raw.filename,
    raw.subfolder ?? "",
    raw.type ?? "output"
  );
  const mtimeMs =
    typeof raw.mtimeMs === "number" && Number.isFinite(raw.mtimeMs)
      ? raw.mtimeMs
      : undefined;
  return { ...ref, mtimeMs };
}

export function parseGalleryIndex(raw: string): GalleryIndexEntry[] {
  try {
    const data = JSON.parse(raw) as Partial<GalleryIndexFile>;
    if (!data || !Array.isArray(data.items)) return [];
    const out: GalleryIndexEntry[] = [];
    const seen = new Set<string>();
    for (const item of data.items) {
      const n = normalizeEntry(item);
      if (!n) continue;
      const key = entryKey(n);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(n);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Odczyt indeksu z Comfy input przez `/view` (tunel).
 * Brak pliku (404) → []; błąd sieci/timeout → rzuca (żeby galeria mogła
 * pokazać „indeks: …” zamiast cicho wracać pustą listę).
 */
export async function loadGalleryIndex(): Promise<GalleryIndexEntry[]> {
  const text = await fetchComfyViewText(GALLERY_INDEX_FILENAME, "", "input", {
    timeoutMs: 12_000,
    minBytes: 2,
    throwOnError: true,
  });
  if (!text) return [];
  return parseGalleryIndex(text);
}

/**
 * Dopisz / odśwież wpisy w indeksie (najnowsze pierwsze, max N).
 * Best-effort — błędy Comfy nie rzucają.
 */
export async function recordGalleryOutputs(
  refs: Array<Partial<GalleryIndexEntry> | ComfyMediaRef>
): Promise<{ ok: boolean; count: number; error?: string }> {
  const incoming: GalleryIndexEntry[] = [];
  const now = Date.now();
  for (const ref of refs) {
    const mtimeMs =
      "mtimeMs" in ref && typeof ref.mtimeMs === "number"
        ? ref.mtimeMs
        : now;
    const n = normalizeEntry({ ...ref, mtimeMs });
    if (n) incoming.push(n);
  }
  if (incoming.length === 0) {
    return { ok: true, count: 0 };
  }

  try {
    const existing = await loadGalleryIndex();
    const byKey = new Map<string, GalleryIndexEntry>();
    for (const e of existing) byKey.set(entryKey(e), e);
    for (const e of incoming) byKey.set(entryKey(e), e);

    const items = Array.from(byKey.values())
      .sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0))
      .slice(0, GALLERY_INDEX_MAX);

    const payload: GalleryIndexFile = {
      version: INDEX_VERSION,
      updatedAt: now,
      items,
    };
    const blob = new Blob([JSON.stringify(payload)], {
      type: "application/octet-stream",
    });
    await uploadFileToComfy(blob, GALLERY_INDEX_FILENAME, {
      overwrite: true,
      type: "input",
    });
    return { ok: true, count: items.length };
  } catch (err) {
    return {
      ok: false,
      count: 0,
      error: err instanceof Error ? err.message : "gallery index write failed",
    };
  }
}
