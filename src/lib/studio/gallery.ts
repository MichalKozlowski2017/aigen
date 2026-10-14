import { promises as fs } from "node:fs";
import path from "node:path";
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

export async function listGallery(options: {
  kind?: "all" | "image" | "video";
  limit?: number;
}): Promise<{ items: GalleryItem[]; configured: boolean; error: string | null }> {
  const root = outputRoot();
  if (!root) {
    return {
      items: [],
      configured: false,
      error:
        "Ustaw COMFYUI_OUTPUT_DIR w .env.local, aby czytać galerię z dysku.",
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
