import { promises as fs } from "node:fs";
import path from "node:path";
import {
  checkComfyHealth,
  listComfyModelFolder,
} from "./comfy-client";
import catalog from "./models-catalog.json";
import { modelsRoot, resolveModelPath } from "./paths";
import { getDownloadJobForModel } from "./downloads";
import type { ModelCatalogEntry, ModelLibraryItem } from "./types";

export function getModelsCatalog(): ModelCatalogEntry[] {
  return catalog as ModelCatalogEntry[];
}

/** Mapowanie targetSubdir katalogu → foldery Comfy GET /models/{folder} (kolejność = priorytet). */
function comfyFoldersForSubdir(subdir: string): string[] {
  switch (subdir) {
    case "checkpoints":
      return ["checkpoints"];
    case "diffusion_models":
      return ["diffusion_models", "unet"];
    case "text_encoders":
      return ["text_encoders", "clip"];
    case "clip":
      return ["clip", "text_encoders"];
    case "vae":
      return ["vae"];
    case "loras":
      return ["loras"];
    case "controlnet":
      return ["controlnet"];
    default:
      return [subdir];
  }
}

function filenameMatch(haystack: string[], filename: string): boolean {
  const target = filename.toLowerCase();
  const base = path.basename(filename).toLowerCase();
  return haystack.some((h) => {
    const n = h.toLowerCase().replace(/\\/g, "/");
    return n === target || n.endsWith(`/${base}`) || path.basename(n) === base;
  });
}

async function loadComfyFolderCache(
  folders: string[]
): Promise<{ cache: Map<string, string[]>; error: string | null }> {
  const cache = new Map<string, string[]>();
  const unique = Array.from(new Set(folders));
  const errors: string[] = [];
  await Promise.all(
    unique.map(async (folder) => {
      try {
        cache.set(folder, await listComfyModelFolder(folder));
      } catch (err) {
        cache.set(folder, []);
        errors.push(
          err instanceof Error ? err.message : `folder ${folder} failed`
        );
      }
    })
  );
  return {
    cache,
    error: errors.length === unique.length ? errors[0] ?? "Comfy models API failed" : null,
  };
}

function isReadyInComfyCache(
  entry: ModelCatalogEntry,
  cache: Map<string, string[]>
): boolean {
  for (const folder of comfyFoldersForSubdir(entry.targetSubdir)) {
    const list = cache.get(folder) ?? [];
    if (filenameMatch(list, entry.filename)) return true;
  }
  return false;
}

export async function listModelsLibrary(): Promise<{
  configured: boolean;
  modelsDir: string | null;
  items: ModelLibraryItem[];
  message: string | null;
  source: "local" | "comfy" | "none";
  downloadsEnabled: boolean;
}> {
  const root = modelsRoot();
  const catalogItems = getModelsCatalog();

  // 1) Lokalny skan dysku (panel na tej samej maszynie co Comfy)
  if (root) {
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
        source: "local",
      });
    }

    return {
      configured: true,
      modelsDir: root,
      items,
      message: null,
      source: "local",
      downloadsEnabled: true,
    };
  }

  // 2) Produkcja (Vercel): lista przez Comfy API / tunel
  const health = await checkComfyHealth();
  if (!health.online) {
    return {
      configured: false,
      modelsDir: null,
      items: catalogItems.map((m) => ({
        ...m,
        status: "missing" as const,
        installedPath: null,
        downloadJobId: null,
        error: null,
        source: "comfy" as const,
      })),
      message:
        "ComfyUI offline (COMFYUI_URL / tunel). Na Vercel status modeli idzie z API Comfy — uruchom Legion + tunnel. COMFYUI_MODELS_DIR jest tylko dla lokalnego panelu (pobieranie na dysk).",
      source: "none",
      downloadsEnabled: false,
    };
  }

  const foldersNeeded = catalogItems.flatMap((e) =>
    comfyFoldersForSubdir(e.targetSubdir)
  );
  const { cache, error: folderError } = await loadComfyFolderCache(foldersNeeded);

  const items: ModelLibraryItem[] = catalogItems.map((entry) => {
    const ready = isReadyInComfyCache(entry, cache);
    return {
      ...entry,
      status: ready ? ("ready" as const) : ("missing" as const),
      installedPath: ready ? `comfy://${entry.targetSubdir}/${entry.filename}` : null,
      downloadJobId: null,
      error: null,
      source: "comfy" as const,
    };
  });

  return {
    configured: true,
    modelsDir: null,
    items,
    message: folderError
      ? `Częściowy odczyt modeli z Comfy: ${folderError}`
      : "Status z ComfyUI (GET /models/…) przez COMFYUI_URL — bez lokalnego COMFYUI_MODELS_DIR.",
    source: "comfy",
    downloadsEnabled: false,
  };
}

export async function listInstalledCheckpoints(): Promise<string[]> {
  const root = modelsRoot();
  if (root) {
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

  try {
    return await listComfyModelFolder("checkpoints");
  } catch {
    return [];
  }
}
