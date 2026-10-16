import { friendlyComfyError, formatFriendlyErrorLines } from "./comfy-errors";
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
): Promise<{
  promptId: string;
  number: number;
  nodeErrors: unknown;
  nodesTotal: number;
}> {
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
  const nodesTotal = Object.keys(workflow).filter((k) => k !== "_meta").length;

  // Zawsze łącz error + node_errors — sam komunikat top-level bywa
  // tylko „Prompt outputs failed validation” bez szczegółów pól.
  const errorPayload = {
    error: data.error,
    node_errors: data.node_errors,
    httpStatus: res.status,
  };

  if (!res.ok || !data.prompt_id) {
    const friendly = friendlyComfyError(errorPayload);
    const err = new Error(formatFriendlyErrorLines(friendly)) as Error & {
      friendly?: ReturnType<typeof friendlyComfyError>;
      nodeErrors?: unknown;
      comfyError?: unknown;
    };
    err.friendly = friendly;
    err.nodeErrors = data.node_errors ?? null;
    err.comfyError = data.error ?? null;
    throw err;
  }

  if (data.node_errors && typeof data.node_errors === "object") {
    const keys = Object.keys(data.node_errors as object);
    if (keys.length > 0) {
      const friendly = friendlyComfyError(errorPayload);
      const err = new Error(formatFriendlyErrorLines(friendly)) as Error & {
        friendly?: ReturnType<typeof friendlyComfyError>;
        nodeErrors?: unknown;
        comfyError?: unknown;
      };
      err.friendly = friendly;
      err.nodeErrors = data.node_errors;
      err.comfyError = data.error ?? null;
      throw err;
    }
  }

  return {
    promptId: data.prompt_id,
    number: data.number ?? 0,
    nodeErrors: data.node_errors ?? null,
    nodesTotal,
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

export type JobProgress = {
  /** 0–100; null = nieznany / indeterminate */
  percent: number | null;
  phase: string;
  queuePending: number;
  queueRunning: boolean;
  currentNodeId: string | null;
  currentNodeType: string | null;
  nodesDone: number | null;
  nodesTotal: number | null;
  executionStartMs: number | null;
  errorMessage: string | null;
  errorHint: string | null;
  errorLinkHref: string | null;
  errorLinkLabel: string | null;
};

export type JobStatus = {
  promptId: string;
  status: "queued" | "running" | "completed" | "failed" | "unknown";
  outputs: Array<{
    filename: string;
    subfolder: string;
    type: string;
  }>;
  progress: JobProgress;
  raw?: unknown;
};

function emptyProgress(partial?: Partial<JobProgress>): JobProgress {
  return {
    percent: null,
    phase: "nieznany",
    queuePending: 0,
    queueRunning: false,
    currentNodeId: null,
    currentNodeType: null,
    nodesDone: null,
    nodesTotal: null,
    executionStartMs: null,
    errorMessage: null,
    errorHint: null,
    errorLinkHref: null,
    errorLinkLabel: null,
    ...partial,
  };
}

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

function workflowNodeCount(promptObj: unknown): number | null {
  if (!promptObj || typeof promptObj !== "object") return null;
  // queue row item may be { prompt: workflow } or the workflow itself
  const rec = promptObj as Record<string, unknown>;
  const wf =
    rec.prompt && typeof rec.prompt === "object"
      ? (rec.prompt as Record<string, unknown>)
      : rec;
  const keys = Object.keys(wf).filter((k) => k !== "_meta");
  return keys.length > 0 ? keys.length : null;
}

function classTypeFromWorkflow(
  promptObj: unknown,
  nodeId: string | null
): string | null {
  if (!nodeId || !promptObj || typeof promptObj !== "object") return null;
  const rec = promptObj as Record<string, unknown>;
  const wf =
    rec.prompt && typeof rec.prompt === "object"
      ? (rec.prompt as Record<string, unknown>)
      : rec;
  const node = wf[nodeId];
  if (!node || typeof node !== "object") return null;
  const ct = (node as { class_type?: string }).class_type;
  return ct ?? null;
}

function parseHistoryProgress(entry: unknown): {
  failed: boolean;
  completed: boolean;
  executionStartMs: number | null;
  nodesDone: number | null;
  errorRaw: unknown;
} {
  const statusMeta = (
    entry as {
      status?: {
        status_str?: string;
        completed?: boolean;
        messages?: unknown[];
      };
    }
  ).status;
  const failed = statusMeta?.status_str === "error";
  const completed = statusMeta?.completed === true || (!failed && Boolean(entry));
  let executionStartMs: number | null = null;
  let nodesDone: number | null = null;
  let errorRaw: unknown = null;
  const messages = statusMeta?.messages;
  if (Array.isArray(messages)) {
    const doneNodes = new Set<string>();
    for (const msg of messages) {
      if (!Array.isArray(msg) || msg.length < 2) continue;
      const type = String(msg[0]);
      const data = msg[1] as Record<string, unknown> | undefined;
      if (type === "execution_start" && data?.timestamp != null) {
        executionStartMs = Number(data.timestamp) * (Number(data.timestamp) < 1e12 ? 1000 : 1);
      }
      if (type === "execution_cached" && Array.isArray(data?.nodes)) {
        for (const n of data.nodes) doneNodes.add(String(n));
      }
      if (type === "executing" && data?.node != null) {
        doneNodes.add(String(data.node));
      }
      if (type === "execution_error") {
        errorRaw = data ?? msg;
      }
    }
    if (doneNodes.size > 0) nodesDone = doneNodes.size;
  }
  return { failed, completed, executionStartMs, nodesDone, errorRaw };
}

export async function getJobStatus(promptId: string): Promise<JobStatus> {
  let queuePending = 0;
  let queueRunning = false;
  let runningPrompt: unknown = null;
  let pendingIndex = -1;

  try {
    const queue = (await getQueue()) as {
      queue_running?: unknown[][];
      queue_pending?: unknown[][];
    };
    const running = queue.queue_running ?? [];
    const pending = queue.queue_pending ?? [];
    queuePending = pending.length;
    for (const row of running) {
      if (Array.isArray(row) && row[1] === promptId) {
        queueRunning = true;
        runningPrompt = row[2] ?? null;
      }
    }
    pending.forEach((row, i) => {
      if (Array.isArray(row) && row[1] === promptId) pendingIndex = i;
    });
  } catch {
    // ignore queue errors
  }

  try {
    const history = (await getHistory(promptId)) as Record<string, unknown>;
    const entry = history[promptId];
    if (entry) {
      const parsed = parseHistoryProgress(entry);
      const outputs = extractOutputs(entry);
      const promptWf =
        (entry as { prompt?: unknown[] }).prompt?.[2] ??
        (entry as { prompt?: unknown }).prompt ??
        null;
      const nodesTotal = workflowNodeCount(promptWf);
      const nodesDone =
        parsed.nodesDone ??
        (parsed.completed && nodesTotal != null ? nodesTotal : parsed.nodesDone);

      if (parsed.failed) {
        const friendly = friendlyComfyError(parsed.errorRaw ?? entry);
        return {
          promptId,
          status: "failed",
          outputs,
          progress: emptyProgress({
            percent: 100,
            phase: "błąd",
            queuePending,
            queueRunning: false,
            nodesDone,
            nodesTotal,
            executionStartMs: parsed.executionStartMs,
            errorMessage: friendly.message,
            errorHint: friendly.hint ?? null,
            errorLinkHref: friendly.linkHref ?? null,
            errorLinkLabel: friendly.linkLabel ?? null,
          }),
          raw: entry,
        };
      }

      if (parsed.completed) {
        return {
          promptId,
          status: "completed",
          outputs,
          progress: emptyProgress({
            percent: 100,
            phase: "gotowe",
            queuePending,
            queueRunning: false,
            nodesDone: nodesTotal,
            nodesTotal,
            executionStartMs: parsed.executionStartMs,
          }),
          raw: entry,
        };
      }

      // W historii, ale jeszcze nie completed — rzadkie
      const pct =
        nodesTotal && nodesDone != null
          ? Math.min(95, Math.round((nodesDone / nodesTotal) * 100))
          : 40;
      return {
        promptId,
        status: "running",
        outputs,
        progress: emptyProgress({
          percent: pct,
          phase: "w trakcie",
          queuePending,
          queueRunning: true,
          nodesDone,
          nodesTotal,
          executionStartMs: parsed.executionStartMs,
        }),
        raw: entry,
      };
    }
  } catch {
    // fall through to queue-only
  }

  if (queueRunning) {
    const nodesTotal = workflowNodeCount(runningPrompt);
    return {
      promptId,
      status: "running",
      outputs: [],
      progress: emptyProgress({
        percent: nodesTotal ? 25 : null,
        phase: "uruchomione w ComfyUI",
        queuePending,
        queueRunning: true,
        currentNodeId: null,
        currentNodeType: classTypeFromWorkflow(runningPrompt, null),
        nodesTotal,
      }),
    };
  }

  if (pendingIndex >= 0) {
    const ahead = pendingIndex;
    const percent = Math.max(2, Math.min(20, 5 + ahead * 0));
    return {
      promptId,
      status: "queued",
      outputs: [],
      progress: emptyProgress({
        percent,
        phase:
          ahead === 0
            ? "w kolejce (następny)"
            : `w kolejce (przed Tobą: ${ahead})`,
        queuePending,
        queueRunning: false,
      }),
    };
  }

  return {
    promptId,
    status: "unknown",
    outputs: [],
    progress: emptyProgress({
      percent: null,
      phase: "oczekiwanie na status…",
      queuePending,
    }),
  };
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

/** Pobierz bajty obrazu z Comfy /view (z timeoutem) — null gdy brak. */
export async function fetchComfyViewBlob(
  filename: string,
  subfolder = "",
  type = "output"
): Promise<Blob | null> {
  try {
    const q = new URLSearchParams({ filename, subfolder, type });
    const res = await fetchComfy(`/view?${q.toString()}`, {
      timeoutMs: 20_000,
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 32) return null;
    const ct = res.headers.get("content-type") || "image/png";
    if (ct.includes("json") || ct.includes("text") || ct.includes("html")) {
      return null;
    }
    return new Blob([buf], { type: ct });
  } catch {
    return null;
  }
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
