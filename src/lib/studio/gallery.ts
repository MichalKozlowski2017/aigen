import { promises as fs } from "node:fs";
import path from "node:path";
import {
  getHistory,
  listComfyInternalFiles,
  withComfyRetry,
} from "./comfy-client";
import { loadGalleryIndex } from "./gallery-index";
import { normalizeComfyMediaRef } from "./comfy-media";
import { outputRoot, resolveOutputFile } from "./paths";
import type { GalleryItem } from "./types";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);
const VIDEO_EXT = new Set([".mp4", ".webm", ".mov", ".mkv"]);

function mimeFor(ext: string): string {
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".mov":
      return "video/quicktime";
    default:
      return "application/octet-stream";
  }
}

function kindFor(ext: string): GalleryItem["kind"] {
  if (IMAGE_EXT.has(ext)) return "image";
  if (VIDEO_EXT.has(ext)) return "video";
  return "other";
}

function comfyViewProxyUrl(
  filename: string,
  subfolder: string,
  type: string
): string {
  const q = new URLSearchParams({ filename, subfolder, type });
  return `/api/comfy-view?${q.toString()}`;
}

async function walk(
  dir: string,
  root: string,
  acc: { abs: string; rel: string }[]
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(root, abs).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".")) continue;
      await walk(abs, root, acc);
    } else if (entry.isFile()) {
      acc.push({ abs, rel });
    }
  }
}

function extractOutputsFromHistoryEntry(
  entry: unknown
): Array<{ filename: string; subfolder: string; type: string }> {
  if (!entry || typeof entry !== "object") return [];
  const outputs = (entry as { outputs?: Record<string, unknown> }).outputs;
  if (!outputs) return [];
  const list: Array<{ filename: string; subfolder: string; type: string }> = [];
  for (const nodeOut of Object.values(outputs)) {
    if (!nodeOut || typeof nodeOut !== "object") continue;
    const images = (nodeOut as { images?: unknown[] }).images;
    const gifs = (nodeOut as { gifs?: unknown[] }).gifs;
    const videos = (nodeOut as { videos?: unknown[] }).videos;
    for (const bucket of [images, gifs, videos]) {
      if (!Array.isArray(bucket)) continue;
      for (const item of bucket) {
        if (!item || typeof item !== "object") continue;
        const rec = item as {
          filename?: string;
          subfolder?: string;
          type?: string;
        };
        if (rec.filename) {
          list.push(
            normalizeComfyMediaRef(
              rec.filename,
              rec.subfolder ?? "",
              rec.type ?? "output"
            )
          );
        }
      }
    }
  }
  return list;
}

type ComfyGalleryRef = {
  filename: string;
  subfolder: string;
  type: string;
  mtimeMs?: number;
};

function pushGalleryRef(
  refs: ComfyGalleryRef[],
  seen: Set<string>,
  filename: string,
  subfolder: string,
  type: string,
  mtimeMs?: number
): void {
  const o = normalizeComfyMediaRef(filename, subfolder, type);
  const key = `${o.type}/${o.subfolder}/${o.filename}`;
  if (seen.has(key)) return;
  seen.add(key);
  refs.push({ ...o, mtimeMs });
}

/**
 * Galeria zdalna (COMFYUI_URL / tunel) — **index-first**:
 * 1) `input/aigen-gallery-index.json` (trwałe po wipe `/history` / reboocie),
 * 2) `/history` (świeże joby; bywa duże i wolne przez tunel),
 * 3) `/internal/files/output` (stock root; tylko gdy indeks pusty / mało wpisów).
 *
 * Gdy indeks da listę, UI działa nawet jeśli historia + internal/files padną.
 */
export async function listGalleryFromComfy(options: {
  kind?: "all" | "image" | "video";
  limit?: number;
}): Promise<{ items: GalleryItem[]; error: string | null }> {
  const kindFilter = options.kind ?? "all";
  const limit = options.limit ?? 60;
  const seen = new Set<string>();
  const refs: ComfyGalleryRef[] = [];
  const errors: string[] = [];
  let indexCount = 0;

  // 1) Indeks — mały JSON, najstabilniejszy przez Quick Tunnel.
  try {
    const indexed = await withComfyRetry(() => loadGalleryIndex(), {
      attempts: 2,
      delayMs: 400,
    });
    indexCount = indexed.length;
    for (const o of indexed) {
      pushGalleryRef(
        refs,
        seen,
        o.filename,
        o.subfolder,
        o.type,
        o.mtimeMs
      );
    }
  } catch (err) {
    errors.push(
      err instanceof Error
        ? `indeks: ${err.message}`
        : "indeks: odczyt nieudany"
    );
  }

  // 2–3) Historia + /internal/files tylko gdy indeks pusty/skąpy.
  // Przy zdrowym indeksie pomijamy flaky endpointy (Quick Tunnel timeouty).
  const needLiveSources = indexCount < Math.min(limit, 8);

  if (needLiveSources) {
    await Promise.all([
      (async () => {
        try {
          const history = (await withComfyRetry(() => getHistory(), {
            attempts: 2,
            delayMs: 400,
          })) as Record<string, unknown>;
          for (const [promptId, entry] of Object.entries(history)) {
            const outs = extractOutputsFromHistoryEntry(entry);
            for (const o of outs) {
              pushGalleryRef(refs, seen, o.filename, o.subfolder, o.type);
            }
            void promptId;
          }
        } catch (err) {
          errors.push(
            err instanceof Error
              ? `historia: ${err.message}`
              : "historia: odczyt nieudany"
          );
        }
      })(),
      (async () => {
        try {
          const internal = await withComfyRetry(
            () => listComfyInternalFiles("output", { timeoutMs: 5_000 }),
            { attempts: 2, delayMs: 300 }
          );
          let order = 0;
          for (const f of internal) {
            order += 1;
            pushGalleryRef(
              refs,
              seen,
              f.filename,
              "",
              f.type || "output",
              Date.now() - order
            );
          }
        } catch (err) {
          errors.push(
            err instanceof Error
              ? `internal/files: ${err.message}`
              : "internal/files: odczyt nieudany"
          );
        }
      })(),
    ]);
  }

  const items: GalleryItem[] = [];
  let order = 0;
  for (const o of refs) {
    const ext = path.extname(o.filename).toLowerCase();
    const kind = kindFor(ext);
    if (kind === "other") continue;
    if (kindFilter !== "all" && kind !== kindFilter) continue;
    order += 1;
    const key = `${o.type}/${o.subfolder}/${o.filename}`;
    items.push({
      id: `comfy:${key}`,
      name: o.filename,
      relativePath: key,
      mime: mimeFor(ext),
      kind,
      sizeBytes: 0,
      mtimeMs: o.mtimeMs ?? Date.now() - order,
      url: comfyViewProxyUrl(o.filename, o.subfolder, o.type),
      source: "comfy",
      comfy: {
        filename: o.filename,
        subfolder: o.subfolder,
        type: o.type,
      },
    });
  }

  items.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const sliced = items.slice(0, limit);

  if (sliced.length === 0 && errors.length > 0) {
    return {
      items: [],
      error: `Galeria Comfy: ${errors.join("; ")}`,
    };
  }

  // Mamy pozycje z indeksu — nie blokuj UI twardym błędem historii/internal.
  if (sliced.length > 0 && errors.length > 0 && indexCount === 0) {
    return {
      items: sliced,
      error: `Galeria częściowa (bez indeksu): ${errors.join("; ")}`,
    };
  }

  return { items: sliced, error: null };
}

async function listGalleryFromDisk(options: {
  kind?: "all" | "image" | "video";
  limit?: number;
}): Promise<{ items: GalleryItem[]; configured: boolean; error: string | null }> {
  const root = outputRoot();
  if (!root) {
    return {
      items: [],
      configured: false,
      error: null,
    };
  }

  try {
    await fs.access(root);
  } catch {
    return {
      items: [],
      configured: true,
      error: `Katalog output nie istnieje: ${root}`,
    };
  }

  const files: { abs: string; rel: string }[] = [];
  await walk(root, root, files);

  const limit = options.limit ?? 60;
  const kindFilter = options.kind ?? "all";

  const withStat = await Promise.all(
    files.map(async (f) => {
      const ext = path.extname(f.abs).toLowerCase();
      const kind = kindFor(ext);
      if (kindFilter !== "all" && kind !== kindFilter) return null;
      if (kind === "other") return null;
      try {
        const st = await fs.stat(f.abs);
        const item: GalleryItem = {
          id: f.rel,
          name: path.basename(f.abs),
          relativePath: f.rel,
          mime: mimeFor(ext),
          kind,
          sizeBytes: st.size,
          mtimeMs: st.mtimeMs,
          url: `/api/gallery/file?path=${encodeURIComponent(f.rel)}`,
          source: "local",
        };
        return item;
      } catch {
        return null;
      }
    })
  );

  const items = withStat
    .filter((x): x is GalleryItem => Boolean(x))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit);

  return { items, configured: true, error: null };
}

/**
 * Preferuje lokalny COMFYUI_OUTPUT_DIR; na Vercel/bez ścieżki —
 * historia Comfy + indeks `aigen-gallery-index.json` + `/internal/files/output`.
 */
export async function listGallery(options: {
  kind?: "all" | "image" | "video";
  limit?: number;
}): Promise<{
  items: GalleryItem[];
  configured: boolean;
  error: string | null;
  source: "local" | "comfy" | "none";
}> {
  const disk = await listGalleryFromDisk(options);
  if (disk.configured && !disk.error) {
    return { ...disk, source: "local" };
  }
  if (disk.configured && disk.error && disk.items.length > 0) {
    return { ...disk, source: "local" };
  }

  const comfy = await listGalleryFromComfy(options);
  if (comfy.items.length > 0 || !comfy.error) {
    return {
      items: comfy.items,
      configured: true,
      error: comfy.error,
      source: "comfy",
    };
  }

  if (disk.configured) {
    return { ...disk, source: "local" };
  }

  return {
    items: [],
    configured: false,
    error:
      comfy.error ??
      "Brak galerii: ustaw COMFYUI_OUTPUT_DIR (panel lokalny) albo upewnij się, że COMFYUI_URL / tunel działa (produkcja czyta historię Comfy).",
    source: "none",
  };
}

export async function readGalleryFile(
  relativePath: string
): Promise<{ absPath: string; mime: string } | null> {
  const abs = resolveOutputFile(relativePath);
  if (!abs) return null;
  try {
    const st = await fs.stat(abs);
    if (!st.isFile()) return null;
  } catch {
    return null;
  }
  const ext = path.extname(abs).toLowerCase();
  return { absPath: abs, mime: mimeFor(ext) };
}
