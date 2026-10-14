import path from "node:path";
import { getModelsDir, getOutputDir } from "./config";

/**
 * Bezpieczne łączenie ścieżki pod rootem — nigdy nie wychodzi poza root.
 * Zwraca null przy próbie escape / nieprawidłowej ścieżce.
 */
export function resolveUnderRoot(
  root: string,
  ...segments: string[]
): string | null {
  const resolvedRoot = path.resolve(root);
  const joined = path.resolve(resolvedRoot, ...segments);
  const relative = path.relative(resolvedRoot, joined);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return joined;
}

export function modelsRoot(): string | null {
  const dir = getModelsDir();
  return dir ? path.resolve(dir) : null;
}

export function outputRoot(): string | null {
  const dir = getOutputDir();
  return dir ? path.resolve(dir) : null;
}

export function resolveModelPath(
  targetSubdir: string,
  filename: string
): string | null {
  const root = modelsRoot();
  if (!root) return null;
  const safeName = path.basename(filename);
  if (!safeName || safeName !== filename.replace(/\\/g, "/").split("/").pop()) {
    return null;
  }
  return resolveUnderRoot(root, targetSubdir, safeName);
}

export function resolveOutputFile(relativePath: string): string | null {
  const root = outputRoot();
  if (!root) return null;
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized.includes("\0") || normalized.startsWith("/")) return null;
  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((p) => p === ".." || p === ".")) return null;
  return resolveUnderRoot(root, ...parts);
}
