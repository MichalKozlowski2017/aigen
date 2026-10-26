import { promises as fs } from "node:fs";
import path from "node:path";
import { uploadFileToComfy } from "./comfy-client";
import { fetchComfyViewBlob } from "./comfy-client";
import {
  cloudClipFilename,
  cloudClipRelativePath,
  fallbackGalleryRoot,
  outputGalleryRoot,
} from "./cloud-gallery";
import { ensureStartImageInComfyInput } from "./ensure-start-image";
import { recordGalleryOutputs } from "./gallery-index";
import { preparePromptForModel } from "./prompt-boost";
import type { GenerateBody } from "./schemas";
import {
  H3_LITE_RESOLUTION,
  H3_LITE_UI_LIMITS,
  MINIMAX_API_KEY_ENV,
  MINIMAX_H3_LITE_MODEL,
  clampH3LiteDuration,
  h3LiteEstimatedUsd,
} from "./video-engines";

/**
 * Oficjalne międzynarodowe API MiniMax (OpenAPI `servers: https://api.minimax.io`).
 * Create: POST /v2/video_generation → task_id.
 * Query: GET /v2/query/video_generation/{task_id} → task.status, task.content.url.
 * Docs na platform.minimax.io to konsola; host wywołań jest api.minimax.io.
 */
export const MINIMAX_API_ORIGIN = "https://api.minimax.io";
export const MINIMAX_CREATE_PATH = "/v2/video_generation";

const QUERY_INTERVAL_MS = 10_000;
const DOWNLOAD_MAX_BYTES = 250 * 1024 * 1024;
const PROMPT_MAX_CHARS = 7000;

const MINIMAX_PROMPT_PREFIX = "minimax:";

export class MinimaxConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MinimaxConfigError";
  }
}

export class MinimaxRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MinimaxRequestError";
  }
}

export type MinimaxSavedOutput = {
  filename: string;
  subfolder: string;
  type: string;
  /** Ustawione, gdy podgląd idzie z dysku galerii, nie z Comfy /view. */
  url?: string;
};

type TaskSnapshot = {
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  videoUrl: string | null;
  errorMessage: string | null;
  queriedAt: number;
};

type JobView = {
  promptId: string;
  status: "queued" | "running" | "completed" | "failed";
  outputs: MinimaxSavedOutput[];
  progress: {
    percent: number | null;
    phase: string;
    stage: "queued" | "running" | "done" | "fail" | "unknown";
    step: null;
    stepMax: null;
    queuePending: number;
    queueRunning: boolean;
    currentNodeId: null;
    currentNodeType: null;
    nodesDone: null;
    nodesTotal: null;
    executionStartMs: number | null;
    errorMessage: string | null;
    errorHint: string | null;
    errorLinkHref: null;
    errorLinkLabel: null;
  };
};

const taskCache = new Map<string, TaskSnapshot>();
const savedCache = new Map<string, MinimaxSavedOutput>();
const inflight = new Map<string, Promise<JobView>>();

export function minimaxPromptId(taskId: string): string {
  return `${MINIMAX_PROMPT_PREFIX}${taskId}`;
}

export function parseMinimaxPromptId(id: string): string | null {
  if (!id.startsWith(MINIMAX_PROMPT_PREFIX)) return null;
  const taskId = id.slice(MINIMAX_PROMPT_PREFIX.length).trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(taskId)) return null;
  return taskId;
}

export function minimaxQueryPath(taskId: string): string {
  return `/v2/query/video_generation/${encodeURIComponent(taskId)}`;
}

/**
 * Ciało create dla image-to-video H3-Lite.
 * I2V: text + image_url role=first_frame. Proporcje biorą się z obrazu
 * (API i tak traktuje ratio jako adaptive), więc ratio nie wysyłamy.
 * Ograniczenie „H3-Lite nie wspiera adaptive” dotyczy reference-to-video, nie I2V.
 */
export function buildH3LiteCreateBody(input: {
  prompt: string;
  imageUrl: string;
  durationSec: number;
}): {
  model: typeof MINIMAX_H3_LITE_MODEL;
  content: Array<
    | { type: "text"; text: string }
    | {
        type: "image_url";
        image_url: { url: string };
        role: "first_frame";
      }
  >;
  resolution: typeof H3_LITE_RESOLUTION;
  duration: number;
} {
  const text = input.prompt.trim().slice(0, PROMPT_MAX_CHARS);
  if (!text) {
    throw new MinimaxRequestError("Prompt po boostcie jest pusty.");
  }
  const imageUrl = input.imageUrl.trim();
  if (!imageUrl) {
    throw new MinimaxRequestError("Brak obrazu startowego.");
  }
  return {
    model: MINIMAX_H3_LITE_MODEL,
    content: [
      { type: "text", text },
      {
        type: "image_url",
        image_url: { url: imageUrl },
        role: "first_frame",
      },
    ],
    resolution: H3_LITE_RESOLUTION,
    duration: clampH3LiteDuration(input.durationSec),
  };
}

function readApiKey(): string {
  const key = process.env[MINIMAX_API_KEY_ENV]?.trim();
  if (!key) {
    throw new MinimaxConfigError(
      `Brak ${MINIMAX_API_KEY_ENV}. Ustaw klucz pay-as-you-go MiniMax (nie subskrypcję i nie pakiet wideo Hailuo) — H3-Lite rozlicza się z salda.`
    );
  }
  return key;
}

function galleryFileUrl(relativePath: string): string {
  return `/api/gallery/file?path=${encodeURIComponent(relativePath)}`;
}

async function fileSavedOnDisk(taskId: string): Promise<MinimaxSavedOutput | null> {
  const filename = cloudClipFilename(taskId);
  const relativePath = cloudClipRelativePath(taskId);
  const roots = [outputGalleryRoot(), fallbackGalleryRoot()];
  for (const root of roots) {
    if (!root) continue;
    const abs = path.join(root, "studio", filename);
    try {
      const st = await fs.stat(abs);
      if (st.isFile() && st.size > 1024) {
        return {
          filename,
          subfolder: root === outputGalleryRoot() ? "studio" : "",
          type: "output",
          url: galleryFileUrl(relativePath),
        };
      }
    } catch {
      // brak pliku
    }
  }
  return null;
}

async function writeMp4(root: string, taskId: string, bytes: Uint8Array): Promise<void> {
  const abs = path.join(root, "studio", cloudClipFilename(taskId));
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, bytes);
}

/**
 * MP4 musi trafić na dysk galerii albo do outputu Comfy.
 * Sam zdalny URL nie pojawia się w galerii.
 */
export async function persistMinimaxMp4(
  taskId: string,
  bytes: Uint8Array
): Promise<MinimaxSavedOutput> {
  const filename = cloudClipFilename(taskId);
  const relativePath = cloudClipRelativePath(taskId);
  const outputRoot = outputGalleryRoot();

  if (outputRoot) {
    await writeMp4(outputRoot, taskId, bytes);
    return {
      filename,
      subfolder: "studio",
      type: "output",
      url: galleryFileUrl(relativePath),
    };
  }

  try {
    const copy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copy).set(bytes);
    const blob = new Blob([copy], { type: "video/mp4" });
    const uploaded = await uploadFileToComfy(blob, filename, {
      overwrite: true,
      type: "output",
      subfolder: "studio",
    });
    const ref = {
      filename: uploaded.name,
      subfolder: uploaded.subfolder || "studio",
      type: uploaded.type || "output",
    };
    const recorded = await recordGalleryOutputs([ref]);
    if (!recorded.ok) {
      throw new Error(recorded.error || "gallery index");
    }
    return ref;
  } catch {
    await writeMp4(fallbackGalleryRoot(), taskId, bytes);
    return {
      filename,
      subfolder: "",
      type: "output",
      url: galleryFileUrl(relativePath),
    };
  }
}

function normalizeImageDataUri(value: string): string {
  const trimmed = value.trim();
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(
    trimmed
  );
  if (!match) {
    throw new MinimaxRequestError(
      "Obraz startowy musi być data URI PNG, JPEG, WebP albo GIF."
    );
  }
  let mime = match[1].toLowerCase();
  if (mime === "image/jpg") mime = "image/jpeg";
  if (
    mime !== "image/jpeg" &&
    mime !== "image/png" &&
    mime !== "image/webp" &&
    mime !== "image/gif"
  ) {
    throw new MinimaxRequestError(
      "MiniMax przyjmuje JPG, JPEG, PNG, WEBP, HEIC albo HEIF. Ten plik ma inny typ."
    );
  }
  const b64 = match[2].replace(/\s+/g, "");
  if (b64.length < 32) {
    throw new MinimaxRequestError("Obraz startowy jest pusty.");
  }
  return `data:${mime};base64,${b64}`;
}

async function imageUrlFromComfy(body: GenerateBody): Promise<string> {
  const startImage = body.startImage?.trim();
  if (!startImage && !body.startImageSource?.filename) {
    throw new MinimaxRequestError(
      "Dodaj obraz startowy. H3-Lite jest tylko image-to-video."
    );
  }
  try {
    const ensured = await ensureStartImageInComfyInput(
      startImage || body.startImageSource?.filename || "",
      body.startImageSource ?? null
    );
    const blob = await fetchComfyViewBlob(ensured.startImage, "", "input");
    if (!blob) {
      throw new Error("brak bajtów");
    }
    const buf = Buffer.from(await blob.arrayBuffer());
    const mime = (blob.type || "image/jpeg").toLowerCase().split(";")[0];
    const safeMime = mime === "image/jpg" ? "image/jpeg" : mime;
    return `data:${safeMime};base64,${buf.toString("base64")}`;
  } catch {
    throw new MinimaxRequestError(
      "ComfyUI nie oddał obrazu startowego. Upuść plik jeszcze raz — H3-Lite wyśle go bez Comfy."
    );
  }
}

async function resolveImageUrl(body: GenerateBody): Promise<string> {
  const data = body.startImageDataUrl?.trim();
  if (data) return normalizeImageDataUri(data);
  return imageUrlFromComfy(body);
}

async function minimaxFetch(
  pathname: string,
  init: { method: string; body?: string; timeoutMs: number }
): Promise<unknown> {
  const key = readApiKey();
  const res = await fetch(`${MINIMAX_API_ORIGIN}${pathname}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body,
    signal: AbortSignal.timeout(init.timeoutMs),
  });
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = null;
    }
  }
  if (!res.ok) {
    const message = minimaxErrorMessage(json) || `MiniMax HTTP ${res.status}`;
    if (res.status === 401) {
      throw new MinimaxConfigError(
        `${message} Sprawdź ${MINIMAX_API_KEY_ENV}: to musi być klucz pay-as-you-go, nie klucz subskrypcji i nie pakiet Hailuo.`
      );
    }
    throw new MinimaxRequestError(message);
  }
  return json;
}

function minimaxErrorMessage(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const rec = json as {
    error?: { message?: unknown };
    message?: unknown;
  };
  if (typeof rec.error?.message === "string" && rec.error.message.trim()) {
    return rec.error.message.trim();
  }
  if (typeof rec.message === "string" && rec.message.trim()) {
    return rec.message.trim();
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

async function createTask(body: ReturnType<typeof buildH3LiteCreateBody>): Promise<string> {
  const json = await minimaxFetch(MINIMAX_CREATE_PATH, {
    method: "POST",
    body: JSON.stringify(body),
    timeoutMs: 30_000,
  });
  const taskId = asRecord(json)?.task_id;
  if (typeof taskId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(taskId)) {
    throw new MinimaxRequestError("MiniMax nie zwrócił task_id.");
  }
  return taskId;
}

async function queryTask(taskId: string): Promise<TaskSnapshot> {
  const json = await minimaxFetch(minimaxQueryPath(taskId), {
    method: "GET",
    timeoutMs: 20_000,
  });
  const task = asRecord(asRecord(json)?.task);
  const statusRaw = typeof task?.status === "string" ? task.status : "";
  const status = (
    ["queued", "running", "succeeded", "failed", "cancelled"] as const
  ).find((s) => s === statusRaw);
  if (!status || !task) {
    throw new MinimaxRequestError("Nieczytelny status zadania MiniMax.");
  }
  const content = asRecord(task.content);
  const videoUrl = typeof content?.url === "string" ? content.url : null;
  const error = asRecord(task.error);
  const errorMessage =
    typeof error?.message === "string" && error.message.trim()
      ? error.message.trim()
      : null;
  return {
    status,
    videoUrl,
    errorMessage,
    queriedAt: Date.now(),
  };
}

function assertHttpsDownload(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new MinimaxRequestError("MiniMax zwrócił nieprawidłowy adres MP4.");
  }
  if (parsed.protocol !== "https:") {
    throw new MinimaxRequestError("Link MP4 MiniMax nie jest https.");
  }
  return parsed.toString();
}

function looksLikeMp4(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12) return false;
  return Buffer.from(bytes.subarray(4, 8)).toString("ascii") === "ftyp";
}

async function downloadMp4(url: string): Promise<Uint8Array> {
  const res = await fetch(assertHttpsDownload(url), {
    redirect: "follow",
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    throw new MinimaxRequestError(
      `Pobieranie MP4 nieudane (HTTP ${res.status}). Odpytam jeszcze raz po świeży link.`
    );
  }
  const declared = Number(res.headers.get("content-length") || "0");
  if (Number.isFinite(declared) && declared > DOWNLOAD_MAX_BYTES) {
    throw new MinimaxRequestError("Plik wideo jest za duży.");
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength < 1024 || buf.byteLength > DOWNLOAD_MAX_BYTES || !looksLikeMp4(buf)) {
    throw new MinimaxRequestError(
      "Odpowiedź nie jest plikiem MP4. Zdalny link sam nie wchodzi do galerii."
    );
  }
  return buf;
}

function emptyJob(
  promptId: string,
  partial: Pick<JobView, "status" | "outputs"> & {
    phase: string;
    stage: JobView["progress"]["stage"];
    percent: number | null;
    errorMessage?: string | null;
  }
): JobView {
  return {
    promptId,
    status: partial.status,
    outputs: partial.outputs,
    progress: {
      percent: partial.percent,
      phase: partial.phase,
      stage: partial.stage,
      step: null,
      stepMax: null,
      queuePending: 0,
      queueRunning: partial.status === "running",
      currentNodeId: null,
      currentNodeType: null,
      nodesDone: null,
      nodesTotal: null,
      executionStartMs: null,
      errorMessage: partial.errorMessage ?? null,
      errorHint: null,
      errorLinkHref: null,
      errorLinkLabel: null,
    },
  };
}

function jobFromSaved(promptId: string, output: MinimaxSavedOutput): JobView {
  return emptyJob(promptId, {
    status: "completed",
    outputs: [output],
    phase: "Klip H3-Lite zapisany w galerii",
    stage: "done",
    percent: 100,
  });
}

async function advanceTask(taskId: string): Promise<JobView> {
  const promptId = minimaxPromptId(taskId);
  const remembered = savedCache.get(taskId);
  if (remembered) return jobFromSaved(promptId, remembered);
  const onDisk = await fileSavedOnDisk(taskId);
  if (onDisk) {
    savedCache.set(taskId, onDisk);
    return jobFromSaved(promptId, onDisk);
  }

  const cached = taskCache.get(taskId);
  const fresh =
    cached && Date.now() - cached.queriedAt < QUERY_INTERVAL_MS
      ? cached
      : null;
  const snapshot = fresh ?? (await queryTask(taskId));
  taskCache.set(taskId, snapshot);

  if (snapshot.status === "failed" || snapshot.status === "cancelled") {
    return emptyJob(promptId, {
      status: "failed",
      outputs: [],
      phase: "MiniMax nie wygenerował klipu",
      stage: "fail",
      percent: 100,
      errorMessage:
        snapshot.errorMessage ||
        (snapshot.status === "cancelled"
          ? "Zadanie MiniMax zostało anulowane."
          : "Zadanie MiniMax nie powiodło się."),
    });
  }

  if (snapshot.status !== "succeeded") {
    return emptyJob(promptId, {
      status: snapshot.status === "queued" ? "queued" : "running",
      outputs: [],
      phase:
        snapshot.status === "queued"
          ? "MiniMax-H3-Lite w kolejce"
          : "MiniMax-H3-Lite generuje klip",
      stage: snapshot.status === "queued" ? "queued" : "running",
      percent: snapshot.status === "queued" ? 12 : 55,
    });
  }

  if (!snapshot.videoUrl) {
    return emptyJob(promptId, {
      status: "running",
      outputs: [],
      phase: "Klip gotowy, czekam na adres MP4",
      stage: "running",
      percent: 80,
    });
  }

  const bytes = await downloadMp4(snapshot.videoUrl);
  const saved = await persistMinimaxMp4(taskId, bytes);
  savedCache.set(taskId, saved);
  return jobFromSaved(promptId, saved);
}

export async function getMinimaxJob(promptId: string): Promise<JobView | null> {
  const taskId = parseMinimaxPromptId(promptId);
  if (!taskId) return null;
  const existing = inflight.get(taskId);
  if (existing) return existing;
  const pending = advanceTask(taskId).finally(() => {
    inflight.delete(taskId);
  });
  inflight.set(taskId, pending);
  return pending;
}

/** Pętla w tle: co 10 s, aż klip jest w galerii albo zadanie padnie. */
export async function pollMinimaxUntilSaved(taskId: string): Promise<void> {
  const deadline = Date.now() + 4 * 60 * 1000;
  while (Date.now() < deadline) {
    try {
      const job = await getMinimaxJob(minimaxPromptId(taskId));
      if (!job) return;
      if (job.status === "completed" || job.status === "failed") return;
    } catch {
      // Kolejny poll (także z przeglądarki) ponowi zapytanie.
    }
    await new Promise((resolve) => setTimeout(resolve, QUERY_INTERVAL_MS));
  }
}

export async function startH3LiteVideo(body: GenerateBody): Promise<{
  taskId: string;
  promptId: string;
  engine: "h3-lite";
  template: "minimax-h3-lite";
  kind: "video";
  durationSec: number;
  estimatedUsd: number;
  model: typeof MINIMAX_H3_LITE_MODEL;
  resolution: typeof H3_LITE_RESOLUTION;
  modelPrompt: string;
  modelNegative: string;
  promptBoost: {
    translated: boolean;
    negativeTranslated: boolean;
    boosted: boolean;
    detectedPolish: boolean;
    provider: "none" | "passthrough" | "mymemory" | "libretranslate" | "openai";
    warnings: string[];
  };
}> {
  if (body.kind !== "video") {
    throw new MinimaxRequestError("H3-Lite jest tylko dla wideo.");
  }
  if (!body.startImage?.trim() && !body.startImageDataUrl?.trim()) {
    throw new MinimaxRequestError(
      "H3-Lite wymaga obrazu startowego (image-to-video)."
    );
  }

  const boost = await preparePromptForModel({
    prompt: body.prompt,
    negativePrompt: "",
    kind: "video",
  });
  const durationSec = clampH3LiteDuration(body.durationSec);
  const imageUrl = await resolveImageUrl(body);
  const createBody = buildH3LiteCreateBody({
    prompt: boost.modelPrompt,
    imageUrl,
    durationSec,
  });
  const taskId = await createTask(createBody);

  return {
    taskId,
    promptId: minimaxPromptId(taskId),
    engine: "h3-lite",
    template: "minimax-h3-lite",
    kind: "video",
    durationSec,
    estimatedUsd: h3LiteEstimatedUsd(durationSec),
    model: MINIMAX_H3_LITE_MODEL,
    resolution: H3_LITE_RESOLUTION,
    modelPrompt: boost.modelPrompt,
    modelNegative: boost.modelNegative,
    promptBoost: {
      translated: boost.translated,
      negativeTranslated: boost.negativeTranslated,
      boosted: boost.boosted,
      detectedPolish: boost.detectedPolish,
      provider: boost.provider,
      warnings: boost.warnings,
    },
  };
}

export { H3_LITE_UI_LIMITS };
