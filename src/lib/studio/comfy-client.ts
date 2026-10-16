import { getComfyUrl } from "./config";
import type { ComfyHealth } from "./types";

const DEFAULT_TIMEOUT_MS = 4_000;

async function fetchComfy(
  pathname: string,
  init?: RequestInit & { timeoutMs?: number }
): Promise<Response> {
  const base = getComfyUrl().replace(/\/$/, "");
  const timeoutMs = init?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const rest = { ...(init ?? {}) };
    delete rest.timeoutMs;
    return await fetch(`${base}${pathname}`, {
      ...rest,
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function checkComfyHealth(): Promise<ComfyHealth> {
  const url = getComfyUrl();
  const started = Date.now();
  try {
    const res = await fetchComfy("/system_stats", { timeoutMs: 3_000 });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      return {
        online: false,
        url,
        latencyMs,
        error: `HTTP ${res.status}`,
      };
    }
    const system = (await res.json().catch(() => null)) as
      | { devices?: unknown }
      | null;
    return {
      online: true,
      url,
      latencyMs,
      error: null,
      system: system ?? undefined,
    };
  } catch (err) {
    return {
      online: false,
      url,
      latencyMs: null,
      error: err instanceof Error ? err.message : "Połączenie nieudane",
    };
  }
}

export async function enqueuePrompt(
  workflow: Record<string, unknown>,
  clientId = "aigen"
): Promise<{ promptId: string; number: number; nodeErrors: unknown }> {
  const res = await fetchComfy("/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
    timeoutMs: 15_000,
  });
  const data = (await res.json().catch(() => ({}))) as {
    prompt_id?: string;
    number?: number;
    node_errors?: unknown;
    error?: unknown;
  };
  if (!res.ok || !data.prompt_id) {
    const message =
      typeof data.error === "string"
        ? data.error
        : data.error
          ? JSON.stringify(data.error)
          : `ComfyUI prompt failed (${res.status})`;
    throw new Error(message);
  }
  return {
    promptId: data.prompt_id,
    number: data.number ?? 0,
    nodeErrors: data.node_errors ?? null,
  };
}

export async function getQueue(): Promise<unknown> {
  const res = await fetchComfy("/queue", { timeoutMs: 5_000 });
  if (!res.ok) throw new Error(`Queue HTTP ${res.status}`);
  return res.json();
}

export async function getHistory(promptId?: string): Promise<unknown> {
  const path = promptId
    ? `/history/${encodeURIComponent(promptId)}`
    : "/history";
  const res = await fetchComfy(path, { timeoutMs: 8_000 });
  if (!res.ok) throw new Error(`History HTTP ${res.status}`);
  return res.json();
}

export type JobStatus = {
  promptId: string;
  status: "queued" | "running" | "completed" | "failed" | "unknown";
  outputs: Array<{
    filename: string;
    subfolder: string;
    type: string;
  }>;
  raw?: unknown;
};

function extractOutputs(entry: unknown): JobStatus["outputs"] {
  if (!entry || typeof entry !== "object") return [];
  const outputs = (entry as { outputs?: Record<string, unknown> }).outputs;
  if (!outputs) return [];
  const list: JobStatus["outputs"] = [];
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
          list.push({
            filename: rec.filename,
            subfolder: rec.subfolder ?? "",
            type: rec.type ?? "output",
          });
        }
      }
    }
  }
  return list;
}

export async function getJobStatus(promptId: string): Promise<JobStatus> {
  try {
    const history = (await getHistory(promptId)) as Record<string, unknown>;
    const entry = history[promptId];
    if (entry) {
      const statusMeta = (entry as { status?: { status_str?: string; completed?: boolean } })
        .status;
      const completed = statusMeta?.completed === true || Boolean(entry);
      const failed = statusMeta?.status_str === "error";
      return {
        promptId,
        status: failed ? "failed" : completed ? "completed" : "running",
        outputs: extractOutputs(entry),
        raw: entry,
      };
    }
  } catch {
    // fall through to queue
  }

  try {
    const queue = (await getQueue()) as {
      queue_running?: unknown[][];
      queue_pending?: unknown[][];
    };
    const inRunning = (queue.queue_running ?? []).some(
      (row) => Array.isArray(row) && row[1] === promptId
    );
    const inPending = (queue.queue_pending ?? []).some(
      (row) => Array.isArray(row) && row[1] === promptId
    );
    if (inRunning) {
      return { promptId, status: "running", outputs: [] };
    }
    if (inPending) {
      return { promptId, status: "queued", outputs: [] };
    }
  } catch {
    // ignore
  }

  return { promptId, status: "unknown", outputs: [] };
}

/** URL do podglądu pliku przez ComfyUI /view (serwer→serwer lub proxy). */
export function comfyViewUrl(
  filename: string,
  subfolder = "",
  type = "output"
): string {
  const base = getComfyUrl().replace(/\/$/, "");
  const q = new URLSearchParams({
    filename,
    subfolder,
    type,
  });
  return `${base}/view?${q.toString()}`;
}

/**
 * Lista plików w folderze modeli ComfyUI (GET /models/{folder}).
 * Zwraca same nazwy plików (lokalny Comfy) albo wyciąga `.name` z formatu cloud.
 */
export async function listComfyModelFolder(
  folder: string
): Promise<string[]> {
  const res = await fetchComfy(`/models/${encodeURIComponent(folder)}`, {
    timeoutMs: 10_000,
  });
  if (!res.ok) {
    throw new Error(`Comfy /models/${folder} HTTP ${res.status}`);
  }
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];
  const names: string[] = [];
  for (const item of data) {
    if (typeof item === "string" && item.trim()) {
      names.push(item.trim());
      continue;
    }
    if (item && typeof item === "object" && "name" in item) {
      const n = String((item as { name: unknown }).name ?? "").trim();
      if (n) names.push(n);
    }
  }
  return names;
}

/** Lista dostępnych typów folderów modeli (GET /models). */
export async function listComfyModelFolders(): Promise<string[]> {
  const res = await fetchComfy("/models", { timeoutMs: 8_000 });
  if (!res.ok) throw new Error(`Comfy /models HTTP ${res.status}`);
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];
  return data
    .map((x) => {
      if (typeof x === "string") return x;
      if (x && typeof x === "object" && "name" in x) {
        return String((x as { name: unknown }).name ?? "");
      }
      return "";
    })
    .filter(Boolean);
}

export type ComfyUploadResult = {
  name: string;
  subfolder: string;
  type: string;
};

/**
 * Upload obrazu do ComfyUI input (POST /upload/image).
 * Zwraca nazwę pliku do LoadImage / startImage.
 */
export async function uploadImageToComfy(
  file: Blob,
  filename: string,
  options?: { overwrite?: boolean; subfolder?: string }
): Promise<ComfyUploadResult> {
  const form = new FormData();
  form.append("image", file, filename);
  form.append("overwrite", options?.overwrite === false ? "false" : "true");
  form.append("type", "input");
  if (options?.subfolder) {
    form.append("subfolder", options.subfolder);
  }

  const res = await fetchComfy("/upload/image", {
    method: "POST",
    body: form,
    timeoutMs: 60_000,
  });
  const data = (await res.json().catch(() => ({}))) as Partial<ComfyUploadResult> & {
    error?: unknown;
  };
  if (!res.ok || !data.name) {
    const message =
      typeof data.error === "string"
        ? data.error
        : data.error
          ? JSON.stringify(data.error)
          : `ComfyUI upload failed (${res.status})`;
    throw new Error(message);
  }
  return {
    name: data.name,
    subfolder: data.subfolder ?? "",
    type: data.type ?? "input",
  };
}
