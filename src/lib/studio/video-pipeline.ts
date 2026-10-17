/**
 * Serwerowa orkiestracja chunków Wan/LTX: c0 → last-frame → c1… → ffmpeg stitch.
 * Stan maszyny jest trzymany w pamięci procesu + /tmp + (best-effort) Comfy input,
 * a każdy GET /api/video/pipeline/[id] robi tick — browser nie jest SPOF dla c1/stitch.
 */
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  enqueuePrompt,
  fetchComfyViewBlob,
  getJobStatus,
  type JobProgress,
  type JobStatus,
  uploadImageToComfy,
} from "./comfy-client";
import { ensureStartImageInComfyInput } from "./ensure-start-image";
import type { LtxChunkPlan } from "./ltx-chunks";
import { preparePromptForModel } from "./prompt-boost";
import type { GenerateBody } from "./schemas";
import { pickChunkOutputs, type MediaRef } from "./video-outputs";
import { stitchComfyClips } from "./video-stitch";
import {
  buildWorkflow,
  isChunkedVideoEngine,
  planVideo,
  type VideoEngineId,
} from "./workflow-builder";

export type VideoPipelineStatus =
  | "queued"
  | "running"
  | "stitching"
  | "completed"
  | "failed";

export type VideoPipelineState = {
  id: string;
  status: VideoPipelineStatus;
  createdAt: number;
  updatedAt: number;
  engine: "wan" | "ltx";
  /** Parametry do buildWorkflow (po boost promptu). */
  body: GenerateBody;
  plan: LtxChunkPlan;
  chunkIndex: number;
  currentPromptId: string | null;
  clips: MediaRef[];
  cursorStart: string;
  cursorSource: MediaRef | null;
  outputs: MediaRef[];
  error: string | null;
  progress: JobProgress;
  modelPrompt?: string;
  modelNegative?: string;
  promptBoostWarnings?: string[];
  /** Lease przeciw podwójnemu enqueue przy concurrent poll (ms epoch). */
  advancingUntil?: number;
};

type PipelineStore = Map<string, VideoPipelineState>;

const GLOBAL_KEY = "__aigen_video_pipelines__";
const LOCKS_KEY = "__aigen_video_pipeline_locks__";

function store(): PipelineStore {
  const g = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: PipelineStore;
  };
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new Map();
  return g[GLOBAL_KEY]!;
}

function locks(): Map<string, Promise<void>> {
  const g = globalThis as typeof globalThis & {
    [LOCKS_KEY]?: Map<string, Promise<void>>;
  };
  if (!g[LOCKS_KEY]) g[LOCKS_KEY] = new Map();
  return g[LOCKS_KEY]!;
}

async function withPipelineLock<T>(
  id: string,
  fn: () => Promise<T>
): Promise<T> {
  const map = locks();
  const prev = map.get(id) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  map.set(
    id,
    prev.then(() => gate).catch(() => gate)
  );
  await prev.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
  }
}

function tmpDir(): string {
  return path.join(os.tmpdir(), "aigen-video-pipelines");
}

function tmpPath(id: string): string {
  return path.join(tmpDir(), `${id}.json`);
}

function comfyStateFilename(id: string): string {
  return `aigen-pipeline-${id}.json`;
}

function emptyProgress(partial?: Partial<JobProgress>): JobProgress {
  return {
    percent: null,
    phase: "pipeline",
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

async function persist(state: VideoPipelineState): Promise<void> {
  state.updatedAt = Date.now();
  store().set(state.id, state);
  try {
    await fs.mkdir(tmpDir(), { recursive: true });
    await fs.writeFile(tmpPath(state.id), JSON.stringify(state), "utf8");
  } catch {
    // /tmp best-effort
  }
  try {
    const blob = new Blob([JSON.stringify(state)], {
      type: "application/json",
    });
    await uploadImageToComfy(blob, comfyStateFilename(state.id), {
      overwrite: true,
    });
  } catch {
    // Comfy może odrzucić non-image — OK, pamięć+/tmp wystarczy na warm instance
  }
}

async function loadPersisted(id: string): Promise<VideoPipelineState | null> {
  const mem = store().get(id);
  if (mem) return mem;

  try {
    const raw = await fs.readFile(tmpPath(id), "utf8");
    const parsed = JSON.parse(raw) as VideoPipelineState;
    if (parsed?.id === id) {
      store().set(id, parsed);
      return parsed;
    }
  } catch {
    // fall through
  }

  try {
    const blob = await fetchComfyViewBlob(comfyStateFilename(id), "", "input");
    if (blob) {
      const text = await blob.text();
      const parsed = JSON.parse(text) as VideoPipelineState;
      if (parsed?.id === id) {
        store().set(id, parsed);
        return parsed;
      }
    }
  } catch {
    // ignore
  }

  return null;
}

export async function getPipeline(
  id: string
): Promise<VideoPipelineState | null> {
  return loadPersisted(id);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** getJobStatus z retry przy transient errors (tunel / GPU busy). */
async function getJobStatusResilient(
  promptId: string,
  attempts = 4
): Promise<JobStatus> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await getJobStatus(promptId);
    } catch (err) {
      lastErr = err;
      await sleep(800 * (i + 1));
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("Nie udało się odpytać joba Comfy");
}

async function enqueueChunk(
  state: VideoPipelineState,
  chunkIndex: number
): Promise<string> {
  const chunk = state.plan.chunks[chunkIndex];
  if (!chunk) throw new Error(`Brak chunka ${chunkIndex} w planie`);

  const isLast = chunkIndex === state.plan.chunkCount - 1;
  const ensured = await ensureStartImageInComfyInput(
    state.cursorStart,
    state.cursorSource
  );

  const body: GenerateBody = {
    ...state.body,
    startImage: ensured.startImage,
    startImageSource: undefined,
    ltxChunkLength: chunk.length,
    ltxSaveTail: !isLast,
    ltxChunkIndex: chunkIndex,
  };

  const { workflow } = buildWorkflow(body);
  const result = await enqueuePrompt(workflow, `aigen-pipe-${state.id}`);

  state.cursorStart = ensured.startImage;
  state.chunkIndex = chunkIndex;
  state.currentPromptId = result.promptId;
  state.status = "running";
  state.progress = emptyProgress({
    percent: Math.round((chunkIndex / state.plan.chunkCount) * 90),
    phase: `chunk ${chunkIndex + 1}/${state.plan.chunkCount}`,
    queueRunning: true,
    nodesTotal: result.nodesTotal,
    executionStartMs: Date.now(),
  });
  await persist(state);
  return result.promptId;
}

function mapChunkProgress(
  state: VideoPipelineState,
  job: JobStatus
): JobProgress {
  const chunkIdx = state.chunkIndex;
  const n = state.plan.chunkCount;
  const base = (chunkIdx / n) * 90;
  const span = 90 / n;
  const local =
    typeof job.progress.percent === "number" ? job.progress.percent / 100 : 0.25;
  return emptyProgress({
    ...job.progress,
    percent: Math.min(94, Math.round(base + local * span)),
    phase: `chunk ${chunkIdx + 1}/${n} · ${job.progress.phase}`,
  });
}

/**
 * Jeden krok maszyny stanów. Bezpieczne do wołania z każdego polla / after().
 */
export async function advancePipeline(
  id: string
): Promise<VideoPipelineState> {
  return withPipelineLock(id, () => advancePipelineUnlocked(id));
}

async function advancePipelineUnlocked(
  id: string
): Promise<VideoPipelineState> {
  const state = await loadPersisted(id);
  if (!state) {
    throw new Error(`Pipeline ${id} nie znaleziony`);
  }
  if (state.status === "completed" || state.status === "failed") {
    return state;
  }

  // Lease aktywny (inny tick enqueue/stitch) — oddaj stan
  if (state.advancingUntil && state.advancingUntil > Date.now()) {
    if (state.status === "stitching" || !state.currentPromptId) {
      return state;
    }
  }

  // Stitch niedokończony (crash / timeout) — ponów gdy lease wygasł
  if (
    state.status === "stitching" &&
    !state.currentPromptId &&
    state.clips.length >= 2 &&
    (!state.advancingUntil || state.advancingUntil <= Date.now())
  ) {
    return finishStitch(state);
  }

  if (state.status === "stitching" && !state.currentPromptId) {
    return state;
  }

  if (!state.currentPromptId) {
    // Po c0…cN-1 ustawiamy null tuż przed enqueue — jeśli utknęło, dociągnięcie
    if (
      state.clips.length === state.chunkIndex + 1 &&
      state.chunkIndex < state.plan.chunkCount - 1 &&
      state.cursorSource &&
      (!state.advancingUntil || state.advancingUntil <= Date.now())
    ) {
      state.advancingUntil = Date.now() + 120_000;
      await persist(state);
      try {
        await enqueueChunk(state, state.chunkIndex + 1);
        state.advancingUntil = undefined;
        await persist(state);
      } catch (err) {
        state.status = "failed";
        state.error =
          err instanceof Error
            ? err.message
            : `Nie udało się uruchomić chunka ${state.chunkIndex + 1}`;
        state.progress = emptyProgress({
          percent: 100,
          phase: "błąd",
          errorMessage: state.error,
        });
        state.advancingUntil = undefined;
        await persist(state);
      }
      return state;
    }

    state.status = "failed";
    state.error = "Pipeline bez aktywnego prompt_id";
    state.progress = emptyProgress({
      percent: 100,
      phase: "błąd",
      errorMessage: state.error,
    });
    await persist(state);
    return state;
  }

  let job: JobStatus;
  try {
    job = await getJobStatusResilient(state.currentPromptId);
  } catch (err) {
    // Transient — nie zabijaj pipeline; UI zobaczy „oczekiwanie”
    state.progress = emptyProgress({
      ...state.progress,
      phase: state.progress.phase || "oczekiwanie na Comfy…",
      errorMessage: null,
      errorHint:
        err instanceof Error
          ? `Tymczasowy błąd odpytania: ${err.message}`
          : "Tymczasowy błąd odpytania joba",
    });
    await persist(state);
    return state;
  }

  if (
    job.status === "queued" ||
    job.status === "running" ||
    job.status === "unknown"
  ) {
    state.status = job.status === "queued" ? "queued" : "running";
    state.progress = mapChunkProgress(state, job);
    await persist(state);
    return state;
  }

  if (job.status === "failed") {
    state.status = "failed";
    state.error =
      job.progress.errorMessage ?? `Chunk ${state.chunkIndex} nieudany`;
    state.progress = emptyProgress({
      percent: 100,
      phase: "błąd",
      errorMessage: state.error,
      errorHint: job.progress.errorHint,
      errorLinkHref: job.progress.errorLinkHref,
      errorLinkLabel: job.progress.errorLinkLabel,
    });
    await persist(state);
    return state;
  }

  // completed chunk — lease zanim enqueue/stitch
  state.advancingUntil = Date.now() + 120_000;
  await persist(state);

  const picked = pickChunkOutputs(job.outputs);
  if (!picked.video) {
    state.status = "failed";
    state.error = `Chunk ${state.chunkIndex} bez pliku mp4 w outputach`;
    state.progress = emptyProgress({
      percent: 100,
      phase: "błąd",
      errorMessage: state.error,
    });
    state.advancingUntil = undefined;
    await persist(state);
    return state;
  }

  // Idempotencja: nie dodawaj drugi raz tego samego klipu
  const already =
    state.clips.length > state.chunkIndex &&
    state.clips[state.chunkIndex]?.filename === picked.video.filename;
  if (!already) {
    // clips.length powinno == chunkIndex przed pushem
    if (state.clips.length === state.chunkIndex) {
      state.clips.push(picked.video);
    } else if (state.clips.length < state.chunkIndex) {
      state.clips.push(picked.video);
    }
  }

  const isLast = state.chunkIndex >= state.plan.chunkCount - 1;

  if (!isLast) {
    if (!picked.tail) {
      state.status = "failed";
      state.error =
        "Brak klatki końcowej (wan-tail/ltx-tail) — nie można kontynuować chunków";
      state.progress = emptyProgress({
        percent: 100,
        phase: "błąd",
        errorMessage: state.error,
      });
      state.advancingUntil = undefined;
      await persist(state);
      return state;
    }
    state.cursorStart = picked.tail.filename;
    state.cursorSource = picked.tail;
    const nextIdx = state.chunkIndex + 1;
    state.currentPromptId = null;
    await persist(state);

    try {
      await enqueueChunk(state, nextIdx);
      state.advancingUntil = undefined;
      await persist(state);
    } catch (err) {
      state.status = "failed";
      state.error =
        err instanceof Error
          ? err.message
          : `Nie udało się uruchomić chunka ${nextIdx}`;
      state.progress = emptyProgress({
        percent: 100,
        phase: "błąd",
        errorMessage: state.error,
      });
      state.advancingUntil = undefined;
      await persist(state);
    }
    return state;
  }

  return finishStitch(state);
}

async function finishStitch(
  state: VideoPipelineState
): Promise<VideoPipelineState> {
  state.status = "stitching";
  state.currentPromptId = null;
  state.advancingUntil = Date.now() + 120_000;
  state.progress = emptyProgress({
    percent: 95,
    phase: "ffmpeg stitch",
  });
  await persist(state);

  try {
    const stitchPrefix =
      state.engine === "wan"
        ? "studio/video-wan-stitched"
        : "studio/video-ltx-stitched";
    const result = await stitchComfyClips({
      clips: state.clips,
      fps: state.plan.fps,
      overlapFrames: state.plan.overlap,
      filenamePrefix: stitchPrefix,
    });
    state.outputs = [
      {
        filename: result.filename,
        subfolder: result.subfolder || "studio",
        type: result.type || "output",
      },
    ];
    state.status = "completed";
    state.progress = emptyProgress({
      percent: 100,
      phase: "gotowe (stitched)",
    });
    state.advancingUntil = undefined;
    await persist(state);
  } catch (err) {
    state.status = "failed";
    state.error = err instanceof Error ? err.message : "Stitch nieudany";
    state.progress = emptyProgress({
      percent: 100,
      phase: "błąd",
      errorMessage: state.error,
    });
    state.advancingUntil = undefined;
    await persist(state);
  }

  return state;
}

export type StartPipelineResult = {
  pipeline: VideoPipelineState;
  /** Ostrzeżenia z boostu promptu */
  warnings: string[];
};

/**
 * Start pipeline: boost prompt → plan → enqueue c0. Zwraca od razu (dalsze chunki na tick).
 */
export async function startVideoPipeline(
  rawBody: GenerateBody
): Promise<StartPipelineResult> {
  if (rawBody.kind !== "video") {
    throw new Error("Pipeline tylko dla kind=video");
  }
  const engine = (rawBody.videoEngine ?? "wan") as VideoEngineId;
  if (!isChunkedVideoEngine(engine)) {
    throw new Error("Pipeline tylko dla Wan/LTX");
  }

  const startImageRaw = rawBody.startImage?.trim();
  if (!startImageRaw) {
    throw new Error("Pipeline wymaga obrazu startowego");
  }

  const ensured = await ensureStartImageInComfyInput(
    startImageRaw,
    rawBody.startImageSource ?? null
  );

  const boost = await preparePromptForModel({
    prompt: rawBody.prompt,
    negativePrompt: rawBody.negativePrompt,
    kind: "video",
  });

  const body: GenerateBody = {
    ...rawBody,
    prompt: boost.modelPrompt,
    negativePrompt: boost.modelNegative,
    startImage: ensured.startImage,
    startImageSource: undefined,
    videoEngine: engine,
  };

  const videoPlan = planVideo(body);
  const plan = videoPlan.chunkPlan;
  if (!plan || !plan.chunked) {
    throw new Error(
      "Video mieści się w 1 chunku — użyj zwykłego /api/generate"
    );
  }

  const id = randomUUID();
  const state: VideoPipelineState = {
    id,
    status: "queued",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    engine: engine === "ltx" ? "ltx" : "wan",
    body,
    plan,
    chunkIndex: 0,
    currentPromptId: null,
    clips: [],
    cursorStart: ensured.startImage,
    cursorSource: null,
    outputs: [],
    error: null,
    progress: emptyProgress({
      percent: 2,
      phase: `chunk 1/${plan.chunkCount}`,
      executionStartMs: Date.now(),
    }),
    modelPrompt: boost.modelPrompt,
    modelNegative: boost.modelNegative,
    promptBoostWarnings: boost.warnings,
  };

  await persist(state);
  await enqueueChunk(state, 0);

  return {
    pipeline: state,
    warnings: boost.warnings,
  };
}

/**
 * Długi tick w tle (po odpowiedzi HTTP) — kontynuuje c1/stitch gdy UI padnie.
 * Budżet czasowy: platforma (Vercel maxDuration) i tak ucięcie; poll i tak dociąga.
 */
export function kickPipelineBackground(
  id: string,
  budgetMs = 240_000
): void {
  void (async () => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      let state: VideoPipelineState;
      try {
        state = await advancePipeline(id);
      } catch {
        await sleep(3_000);
        continue;
      }
      if (state.status === "completed" || state.status === "failed") break;
      // Comfy liczy — rzadziej odpytuj
      const wait =
        state.status === "running" || state.status === "queued" ? 8_000 : 2_000;
      await sleep(wait);
    }
  })();
}

/** Publiczny kształt joba jak /api/jobs/[id] — UI może reuse poller. */
export function pipelineToJobView(state: VideoPipelineState): {
  promptId: string;
  pipelineId: string;
  status: "queued" | "running" | "completed" | "failed" | "unknown";
  outputs: MediaRef[];
  progress: JobProgress;
  chunk: { index: number; total: number; label: string } | null;
} {
  const status =
    state.status === "stitching"
      ? "running"
      : state.status === "queued"
        ? "queued"
        : state.status === "running"
          ? "running"
          : state.status === "completed"
            ? "completed"
            : state.status === "failed"
              ? "failed"
              : "unknown";

  const chunkLabel =
    state.status === "stitching"
      ? `sklejanie ${state.clips.length} odcinków…`
      : state.status === "completed"
        ? null
        : `chunk ${state.chunkIndex + 1}/${state.plan.chunkCount}`;

  return {
    promptId: state.currentPromptId ?? state.id,
    pipelineId: state.id,
    status,
    outputs:
      state.status === "completed"
        ? state.outputs
        : state.clips.length > 0
          ? [state.clips[state.clips.length - 1]!]
          : [],
    progress: {
      ...state.progress,
      errorMessage:
        state.status === "failed"
          ? state.error ?? state.progress.errorMessage
          : state.progress.errorMessage,
    },
    chunk: chunkLabel
      ? {
          index: Math.min(state.chunkIndex + 1, state.plan.chunkCount),
          total: state.plan.chunkCount,
          label: chunkLabel,
        }
      : null,
  };
}
