import path from "node:path";
import os from "node:os";
import { getOutputDir } from "./config";
import { resolveUnderRoot } from "./paths";

/** Podkatalog wspólny dla klipów chmurowych (lokalny output albo fallback). */
export const CLOUD_VIDEO_SUBDIR = "studio";

/**
 * Katalog tymczasowy, gdy nie ma COMFYUI_OUTPUT_DIR i Comfy nie przyjmie pliku.
 * Galeria czyta go przez /api/gallery/file.
 */
export function fallbackGalleryRoot(): string {
  return path.join(os.tmpdir(), "aigen-gallery");
}

export function outputGalleryRoot(): string | null {
  const dir = getOutputDir();
  return dir ? path.resolve(dir) : null;
}

export function cloudClipFilename(taskId: string): string {
  const safe = taskId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
  return `minimax-${safe || "clip"}.mp4`;
}

export function cloudClipRelativePath(taskId: string): string {
  return `${CLOUD_VIDEO_SUBDIR}/${cloudClipFilename(taskId)}`;
}

/** Ścieżka pod fallback rootem. null przy próbie wyjścia poza katalog. */
export function resolveFallbackGalleryFile(relativePath: string): string | null {
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized.includes("\0") || normalized.startsWith("/")) return null;
  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((p) => p === ".." || p === ".")) return null;
  return resolveUnderRoot(fallbackGalleryRoot(), ...parts);
}
