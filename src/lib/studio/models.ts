import { promises as fs } from "node:fs";
import path from "node:path";
import catalog from "./models-catalog.json";
import { modelsRoot, resolveModelPath } from "./paths";
import { getDownloadJobForModel } from "./downloads";
import type { ModelCatalogEntry, ModelLibraryItem } from "./types";

export function getModelsCatalog(): ModelCatalogEntry[] {
  return catalog as ModelCatalogEntry[];
}

export async function listModelsLibrary(): Promise<{
  configured: boolean;
  modelsDir: string | null;
  items: ModelLibraryItem[];
  message: string | null;
}> {
  const root = modelsRoot();
  const catalogItems = getModelsCatalog();

  if (!root) {
    return {
      configured: false,
      modelsDir: null,
      items: catalogItems.map((m) => ({
        ...m,
        status: "missing",
        installedPath: null,
        downloadJobId: null,
        error: null,
      })),
      message:
        "Ustaw COMFYUI_MODELS_DIR w .env.local, aby skanować i pobierać modele.",
    };
  }

  const items: ModelLibraryItem[] = [];
  for (const entry of catalogItems) {
    const installedPath = resolveModelPath(entry.targetSubdir, entry.filename);
    let ready = false;
    if (installedPath) {
      try {
        await fs.access(installedPath);
        ready = true;
      } catch {
        ready = false;
      }
    }

    const job = getDownloadJobForModel(entry.id);
    let status: ModelLibraryItem["status"] = ready ? "ready" : "missing";
    let error: string | null = null;
    let downloadJobId: string | null = null;

    if (job && (job.status === "queued" || job.status === "downloading")) {
      status = "downloading";
      downloadJobId = job.id;
    } else if (job?.status === "error" && !ready) {
      status = "error";
      error = job.error;
      downloadJobId = job.id;
    } else if (ready) {
      status = "ready";
    }

    items.push({
      ...entry,
      status,
      installedPath: ready ? installedPath : null,
      downloadJobId,
      error,
    });
  }

  return {
    configured: true,
    modelsDir: root,
    items,
    message: null,
  };
}

export async function listInstalledCheckpoints(): Promise<string[]> {
  const root = modelsRoot();
  if (!root) return [];
  const dir = path.join(root, "checkpoints");
  try {
    const names = await fs.readdir(dir);
    return names.filter(
      (n) =>
        n.endsWith(".safetensors") ||
        n.endsWith(".ckpt") ||
        n.endsWith(".pt")
    );
  } catch {
    return [];
  }
}
