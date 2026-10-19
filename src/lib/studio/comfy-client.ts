import { friendlyComfyError, formatFriendlyErrorLines } from "./comfy-errors";
import { normalizeComfyMediaRef } from "./comfy-media";
import {
  classifyNodeType,
  formatPolishPhase,
  percentForStage,
  type ProgressStage,
} from "./comfy-progress";
import {
  ensureLiveProgressFeed,
  getCachedExecutingNode,
  getCachedLiveProgress,
} from "./comfy-progress-live";
import { getComfyUrl, getComfyUrlAsync } from "./config";
import type { ComfyHealth } from "./types";

const DEFAULT_TIMEOUT_MS = 4_000;

/** Krótki opis błędu fetch (timeout vs sieć) + host z COMFYUI_URL. */
export function describeComfyFetchError(
  err: unknown,
  timeoutMs?: number
): string {
  let host = "";
  try {
    host = new URL(getComfyUrl()).host;
  } catch {
    host = getComfyUrl();
  }
  const suffix = host ? ` → ${host}` : "";

  if (err instanceof Error) {
    const name = err.name || "";
    const msg = err.message || "";
    if (
      name === "AbortError" ||
      name === "TimeoutError" ||
      /aborted|abort/i.test(msg)
    ) {
      return `timeout ${timeoutMs ?? DEFAULT_TIMEOUT_MS}ms${suffix}`;
    }
    const cause = (err as Error & { cause?: unknown }).cause;
    let detail = msg || "fetch failed";
    if (cause && typeof cause === "object" && cause !== null) {
      const c = cause as { code?: unknown; message?: unknown };
      if (typeof c.code === "string" || typeof c.code === "number") {
        detail = `${detail} (${String(c.code)})`;
      } else if (typeof c.message === "string" && c.message) {
        detail = `${detail} (${c.message})`;
      }
    } else if (cause instanceof Error && cause.message) {
      detail = `${detail} (${cause.message})`;
    }
    return `${detail}${suffix}`;
  }
  return `Połączenie nieudane${suffix}`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** 1–2 krótkie retry na flaky tunel (ECONNRESET / chwilowy 5xx nie tu — tylko throw). */
export async function withComfyRetry<T>(
  fn: () => Promise<T>,
  options?: { attempts?: number; delayMs?: number }
): Promise<T> {
  const attempts = Math.max(1, options?.attempts ?? 2);
  const delayMs = options?.delayMs ?? 350;
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (i < attempts - 1) await sleep(delayMs * (i + 1));
    }
  }
  throw last;
}

async function fetchComfy(
  pathname: string,
  init?: RequestInit & { timeoutMs?: number }
): Promise<Response> {
  const base = (await getComfyUrlAsync()).replace(/\/$/, "");
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
  } catch (err) {
    throw new Error(describeComfyFetchError(err, timeoutMs));
  } finally {
    clearTimeout(timer);
  }
}

export async function checkComfyHealth(): Promise<ComfyHealth> {
  const url = await getComfyUrlAsync();
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

/**
 * Soft unload wag z VRAM/RAM Comfy (POST /free) — bez restartu procesu.
 * Domyślnie unload_models + free_memory (jak przycisk „Zwolnij modele”).
 */
export async function freeComfyMemory(options?: {
  unloadModels?: boolean;
  freeMemory?: boolean;
}): Promise<{ ok: true }> {
  const unloadModels = options?.unloadModels !== false;
  const freeMemory = options?.freeMemory !== false;
  const res = await fetchComfy("/free", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      unload_models: unloadModels,
      free_memory: freeMemory,
    }),
    timeoutMs: 30_000,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      text
        ? `Comfy /free HTTP ${res.status}: ${text.slice(0, 200)}`
        : `Comfy /free HTTP ${res.status}`
    );
  }
  return { ok: true };
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
  /** 0–100; null = nieznany / indeterminate (nie kłam 25%) */
  percent: number | null;
  phase: string;
  /** Klucz etapu do UI / pipeline */
  stage: ProgressStage;
  /** Sampling step (Comfy WS progress.value) */
  step: number | null;
  /** Sampling max (Comfy WS progress.max) */
  stepMax: number | null;
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

export function emptyProgress(partial?: Partial<JobProgress>): JobProgress {
  return {
    percent: null,
    phase: "nieznany",
    stage: "unknown",
    step: null,
    stepMax: null,
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
          // VHS: subfolder=studio jest wymagany dla /view
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

function buildRunningProgress(opts: {
  promptId: string;
  workflow: unknown;
  queuePending: number;
  nodesDone?: number | null;
  nodesTotal?: number | null;
  executionStartMs?: number | null;
}): JobProgress {
  const live = getCachedLiveProgress(opts.promptId);
  const nodeId =
    getCachedExecutingNode(opts.promptId) ?? live?.nodeId ?? null;
  const nodeType = classTypeFromWorkflow(opts.workflow, nodeId);
  const stage: ProgressStage =
    live && live.max > 0
      ? "sampling"
      : classifyNodeType(nodeType);
  const step = live && live.max > 0 ? live.value : null;
  const stepMax = live && live.max > 0 ? live.max : null;
  const percent = percentForStage({
    stage,
    step,
    stepMax,
    nodesDone: opts.nodesDone ?? null,
    nodesTotal: opts.nodesTotal ?? null,
  });
  return emptyProgress({
    percent,
    stage,
    step,
    stepMax,
    phase: formatPolishPhase({
      stage,
      nodeType,
      step,
      stepMax,
      nodesDone: opts.nodesDone,
      nodesTotal: opts.nodesTotal,
    }),
    queuePending: opts.queuePending,
    queueRunning: true,
    currentNodeId: nodeId,
    currentNodeType: nodeType,
    nodesDone: opts.nodesDone ?? null,
    nodesTotal: opts.nodesTotal ?? null,
    executionStartMs: opts.executionStartMs ?? null,
  });
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

  // Live sampling/node z Comfy WS (gdy tunel pozwala) — bez sztucznego 25%
  if (queueRunning || pendingIndex >= 0) {
    await ensureLiveProgressFeed(queueRunning ? 700 : 0);
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
        // Full lines (message + hint + details) so UI never shows bare „Chunk failed”
        // without Comfy exception text (e.g. CUDA no-kernel / node_errors dump).
        const full = formatFriendlyErrorLines(friendly);
        return {
          promptId,
          status: "failed",
          outputs,
          progress: emptyProgress({
            percent: 100,
            stage: "fail",
            phase: formatPolishPhase({ stage: "fail" }),
            queuePending,
            queueRunning: false,
            nodesDone,
            nodesTotal,
            executionStartMs: parsed.executionStartMs,
            errorMessage: full || friendly.message,
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
            stage: "done",
            phase: formatPolishPhase({ stage: "done" }),
            queuePending,
            queueRunning: false,
            nodesDone: nodesTotal,
            nodesTotal,
            executionStartMs: parsed.executionStartMs,
          }),
          raw: entry,
        };
      }

      // W historii, ale jeszcze nie completed — połącz z live WS
      return {
        promptId,
        status: "running",
        outputs,
        progress: buildRunningProgress({
          promptId,
          workflow: promptWf,
          queuePending,
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
      progress: buildRunningProgress({
        promptId,
        workflow: runningPrompt,
        queuePending,
        nodesTotal,
      }),
    };
  }

  if (pendingIndex >= 0) {
    const ahead = pendingIndex;
    const stage: ProgressStage = "queued";
    return {
      promptId,
      status: "queued",
      outputs: [],
      progress: emptyProgress({
        percent: percentForStage({ stage }),
        stage,
        phase: formatPolishPhase({ stage, queueAhead: ahead }),
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
      stage: "unknown",
      phase: formatPolishPhase({ stage: "unknown" }),
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
    // Obrazy/wideo — odrzuć HTML/JSON (błędy proxy). Tekst/JSON: fetchComfyViewText.
    if (ct.includes("json") || ct.includes("text") || ct.includes("html")) {
      return null;
    }
    return new Blob([buf], { type: ct });
  } catch {
    return null;
  }
}

/**
 * Pobierz treść tekstową/JSON z Comfy /view (np. stan pipeline w input/).
 * W przeciwieństwie do fetchComfyViewBlob NIE odrzuca content-type json/text.
 */
export async function fetchComfyViewText(
  filename: string,
  subfolder = "",
  type = "input",
  options?: {
    timeoutMs?: number;
    minBytes?: number;
    /** true = sieć/HTTP 5xx rzuca (galeria indeks); false = null (pipeline best-effort) */
    throwOnError?: boolean;
  }
): Promise<string | null> {
  const timeoutMs = options?.timeoutMs ?? 20_000;
  try {
    const q = new URLSearchParams({ filename, subfolder, type });
    const res = await fetchComfy(`/view?${q.toString()}`, { timeoutMs });
    if (!res.ok) {
      // 404 = brak pliku — to nie awaria sieci.
      if (res.status === 404 || res.status === 400) return null;
      if (options?.throwOnError) {
        throw new Error(`HTTP ${res.status}`);
      }
      return null;
    }
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("html")) return null;
    const text = await res.text();
    const min = options?.minBytes ?? 2;
    if (text.length < min) return null;
    const trimmed = text.trimStart();
    if (
      trimmed.startsWith("<!DOCTYPE") ||
      trimmed.startsWith("<html") ||
      trimmed.startsWith("<HTML")
    ) {
      return null;
    }
    return text;
  } catch (err) {
    if (options?.throwOnError) {
      throw err instanceof Error
        ? err
        : new Error(describeComfyFetchError(err, timeoutMs));
    }
    return null;
  }
}

/**
 * true gdy klasa node'a jest w Comfy `/object_info` (graceful false przy offline).
 */
export async function comfyHasNodeClass(
  classType: string,
  options?: { timeoutMs?: number }
): Promise<boolean> {
  const name = classType.trim();
  if (!name) return false;
  try {
    const res = await fetchComfy(
      `/object_info/${encodeURIComponent(name)}`,
      { timeoutMs: options?.timeoutMs ?? 4_000 }
    );
    if (!res.ok) return false;
    const data = (await res.json().catch(() => null)) as unknown;
    if (!data || typeof data !== "object") return false;
    return name in (data as Record<string, unknown>);
  } catch {
    return false;
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

/**
 * Lista plików w katalogu Comfy (GET /internal/files/{output|input|temp}).
 * Stock API frontendu Comfy — tylko pliki w root katalogu (bez podfolderów typu studio/).
 * Odpowiedź: `["name.ext [output]", ...]`.
 */
export async function listComfyInternalFiles(
  directoryType: "output" | "input" | "temp",
  options?: { timeoutMs?: number }
): Promise<Array<{ filename: string; type: string }>> {
  // Krótki timeout — endpoint bywa wolny / flaky przez Quick Tunnel; indeks jest SoT.
  const timeoutMs = options?.timeoutMs ?? 5_000;
  const res = await fetchComfy(`/internal/files/${directoryType}`, {
    timeoutMs,
  });
  if (!res.ok) {
    throw new Error(`Comfy /internal/files/${directoryType} HTTP ${res.status}`);
  }
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];
  const out: Array<{ filename: string; type: string }> = [];
  for (const item of data) {
    if (typeof item !== "string") continue;
    const m = item.match(/^(.*) \[([^\]]+)\]\s*$/);
    const filename = (m ? m[1] : item).trim();
    const type = (m ? m[2] : directoryType).trim() || directoryType;
    if (!filename || filename.startsWith("_")) continue;
    out.push({ filename, type });
  }
  return out;
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
 * Upload pliku do ComfyUI (POST /upload/image) — działa też dla JSON/txt/mp4.
 * Domyślnie type=input (trwały katalog na hoście Comfy, przeżywa cold start Vercel).
 */
export async function uploadFileToComfy(
  file: Blob,
  filename: string,
  options?: { overwrite?: boolean; subfolder?: string; type?: string }
): Promise<ComfyUploadResult> {
  const form = new FormData();
  form.append("image", file, filename);
  form.append("overwrite", options?.overwrite === false ? "false" : "true");
  form.append("type", options?.type ?? "input");
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
    type: data.type ?? options?.type ?? "input",
  };
}

/**
 * Upload obrazu do ComfyUI input (POST /upload/image).
 * Zwraca nazwę pliku do LoadImage / startImage.
 */
export async function uploadImageToComfy(
  file: Blob,
  filename: string,
  options?: { overwrite?: boolean; subfolder?: string }
): Promise<ComfyUploadResult> {
  return uploadFileToComfy(file, filename, options);
}
