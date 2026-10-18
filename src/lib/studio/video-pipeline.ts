/**
 * Serwerowa orkiestracja chunków Wan/LTX: c0 → last-frame → c1… → ffmpeg stitch.
 * Stan: pamięć procesu + /tmp + durable JSON w Comfy input/ (przeżywa cold start Vercel).
 * GET /api/video/pipeline/[id] rehydrate z Comfy przy miss, potem tick (advance).
 */
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  emptyProgress,
  enqueuePrompt,
  fetchComfyViewText,
  getJobStatus,
  type JobProgress,
  type JobStatus,
  uploadFileToComfy,
} from "./comfy-client";
import {
  engineLabelFromId,
  formatPolishPhase,
  percentForStage,
} from "./comfy-progress";
import { ensureStartImageInComfyInput } from "./ensure-start-image";
import { recordGalleryOutputs } from "./gallery-index";
import type { LtxChunkPlan } from "./ltx-chunks";
import { preparePromptForModel } from "./prompt-boost";
import type { GenerateBody } from "./schemas";
import { pickChunkOutputs, type MediaRef } from "./video-outputs";
import { runVideoPostProcess } from "./video-postprocess";
import { stitchComfyClips } from "./video-stitch";
import { coerceWanFast480pGeometry } from "./wan-distill";
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
  /** Ostrzeżenia z RIFE / upscale (graceful skip). */
  postProcessWarnings?: string[];
  /** Lease przeciw podwójnemu enqueue przy concurrent poll (ms epoch). */
  advancingUntil?: number;
  /** Ostatni udany zapis durable do Comfy input (ms epoch). */
  durableSavedAt?: number;
  /** Nazwa pliku stanu w Comfy input (json lub txt fallback). */
  durableFilename?: string;
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

function comfyStateFilenames(id: string): string[] {
  // .json preferowane; .txt gdy Comfy/proxy odrzuca rozszerzenie json
  return [`aigen-pipeline-${id}.json`, `aigen-pipeline-${id}.txt`];
}

function parsePipelineState(
  raw: string,
  id: string
): VideoPipelineState | null {
  try {
    const parsed = JSON.parse(raw) as VideoPipelineState;
    if (parsed?.id === id && parsed.plan && parsed.body) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Durable zapis do Comfy input — jedyne źródło prawdy po cold start / redeploy Vercel.
 * Zwraca true gdy upload się udał (read-back opcjonalny przy checkpointach).
 */
async function persistToComfy(
  state: VideoPipelineState,
  options?: { verify?: boolean }
): Promise<boolean> {
  const payload = JSON.stringify(state);
  const preferred = state.durableFilename;
  const names = preferred
    ? [preferred, ...comfyStateFilenames(state.id).filter((n) => n !== preferred)]
    : comfyStateFilenames(state.id);

  for (const name of names) {
    try {
      const blob = new Blob([payload], { type: "application/octet-stream" });
      const uploaded = await uploadFileToComfy(blob, name, {
        overwrite: true,
        type: "input",
      });
      const savedName = uploaded.name || name;
      if (options?.verify) {
        const back = await fetchComfyViewText(savedName, "", "input", {
          timeoutMs: 15_000,
        });
        const parsed = back ? parsePipelineState(back, state.id) : null;
        if (!parsed) continue;
      }
      state.durableFilename = savedName;
      state.durableSavedAt = Date.now();
      return true;
    } catch {
      // spróbuj kolejnej nazwy
    }
  }
  return false;
}

/** Checkpoint-y: zmiana chunka / promptu / statusu terminalnego — warto verify. */
function isDurableCheckpoint(
  prev: VideoPipelineState | undefined,
  next: VideoPipelineState
): boolean {
  if (!prev) return true;
  if (prev.status !== next.status) return true;
  if (prev.chunkIndex !== next.chunkIndex) return true;
  if (prev.currentPromptId !== next.currentPromptId) return true;
  if (prev.clips.length !== next.clips.length) return true;
  return false;
}

async function persist(state: VideoPipelineState): Promise<void> {
  const prev = store().get(state.id);
  const checkpoint = isDurableCheckpoint(prev, state);
  state.updatedAt = Date.now();
  store().set(state.id, state);
  try {
    await fs.mkdir(tmpDir(), { recursive: true });
    await fs.writeFile(tmpPath(state.id), JSON.stringify(state), "utf8");
  } catch {
    // /tmp best-effort (ginie na Vercel)
  }
  // Durable tylko na checkpointach (enqueue / chunk done / stitch / fail) —
  // progress tick nie spamuje Comfy, a cold start i tak wznawia z ostatniego checkpointu.
  if (checkpoint) {
    await persistToComfy(state, { verify: true });
    store().set(state.id, state);
    try {
      await fs.writeFile(tmpPath(state.id), JSON.stringify(state), "utf8");
    } catch {
      // ignore
    }
  }
}

async function loadFromComfy(id: string): Promise<VideoPipelineState | null> {
  for (const name of comfyStateFilenames(id)) {
    try {
      const text = await fetchComfyViewText(name, "", "input", {
        timeoutMs: 20_000,
      });
      const parsed = text ? parsePipelineState(text, id) : null;
      if (parsed) {
        parsed.durableFilename = name;
        return parsed;
      }
    } catch {
      // next name
    }
  }
  return null;
}

async function loadPersisted(id: string): Promise<VideoPipelineState | null> {
  const mem = store().get(id);
  if (mem) return mem;

  try {
    const raw = await fs.readFile(tmpPath(id), "utf8");
    const parsed = parsePipelineState(raw, id);
    if (parsed) {
      store().set(id, parsed);
      return parsed;
    }
  } catch {
    // fall through → Comfy durable
  }

  const fromComfy = await loadFromComfy(id);
  if (fromComfy) {
    // Po cold start: lease z martwego instance nie może blokować c1/stitch
    fromComfy.advancingUntil = undefined;
    store().set(id, fromComfy);
    try {
      await fs.mkdir(tmpDir(), { recursive: true });
      await fs.writeFile(tmpPath(id), JSON.stringify(fromComfy), "utf8");
    } catch {
      // ignore
    }
    return fromComfy;
  }

  return null;
}

/**
 * Jawny rehydrate (np. GET gdy memory miss) — zawsze pyta Comfy, nawet gdy /tmp puste.
 */
export async function rehydratePipeline(
  id: string
): Promise<VideoPipelineState | null> {
  const existing = store().get(id);
  if (existing) return existing;
  return loadPersisted(id);
}

export async function getPipeline(
  id: string
): Promise<VideoPipelineState | null> {
  return rehydratePipeline(id);
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

  const { workflow, warnings: wfWarnings } = await buildWorkflow(body);
  if (wfWarnings?.length) {
    state.promptBoostWarnings = [
      ...(state.promptBoostWarnings ?? []),
      ...wfWarnings,
    ];
  }
  const result = await enqueuePrompt(workflow, `aigen-pipe-${state.id}`);

  state.cursorStart = ensured.startImage;
  state.chunkIndex = chunkIndex;
  state.currentPromptId = result.promptId;
  state.status = "running";
  const engineLabel = engineLabelFromId(state.engine);
  const displayChunk = chunkIndex + 1;
  const chunkTotal = state.plan.chunkCount;
  state.progress = emptyProgress({
    // Start chunka — niski % w paśmie chunka, nie fake 25 całego joba
    percent: Math.round((chunkIndex / chunkTotal) * 90 + 1),
    stage: "loading",
    phase: formatPolishPhase({
      stage: "loading",
      engineLabel,
      chunkIndex: displayChunk,
      chunkTotal,
    }),
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
  const chunkIndex = chunkIdx + 1;
  const base = (chunkIdx / n) * 90;
  const span = 90 / n;
  const engineLabel = engineLabelFromId(state.engine);
  const localPct =
    typeof job.progress.percent === "number" ? job.progress.percent : null;
  // Bez fake 25%: brak % joba → tylko baza chunka (start etapu) albo null
  const percent =
    localPct != null
      ? Math.min(94, Math.round(base + (localPct / 100) * span))
      : Math.round(base + span * 0.02);

  const stage = job.progress.stage ?? "running";
  return emptyProgress({
    ...job.progress,
    percent,
    stage,
    phase: formatPolishPhase({
      stage,
      nodeType: job.progress.currentNodeType,
      step: job.progress.step,
      stepMax: job.progress.stepMax,
      engineLabel,
      chunkIndex,
      chunkTotal: n,
      nodesDone: job.progress.nodesDone,
      nodesTotal: job.progress.nodesTotal,
    }),
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

  // Stitch/post niedokończony (crash / timeout) — ponów gdy lease wygasł
  if (
    state.status === "stitching" &&
    !state.currentPromptId &&
    state.clips.length >= 1 &&
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
          stage: "fail",
          phase: formatPolishPhase({ stage: "fail" }),
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
      stage: "fail",
      phase: formatPolishPhase({ stage: "fail" }),
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
      stage: state.progress.stage ?? "unknown",
      phase: state.progress.phase || formatPolishPhase({ stage: "unknown" }),
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
      stage: "fail",
      phase: formatPolishPhase({ stage: "fail" }),
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
      stage: "fail",
      phase: formatPolishPhase({ stage: "fail" }),
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
        stage: "fail",
        phase: formatPolishPhase({ stage: "fail" }),
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
        stage: "fail",
        phase: formatPolishPhase({ stage: "fail" }),
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
  state.advancingUntil = Date.now() + 180_000;
  state.progress = emptyProgress({
    percent: percentForStage({ stage: "stitch" }) ?? 92,
    stage: "stitch",
    phase: formatPolishPhase({ stage: "stitch" }),
  });
  await persist(state);

  try {
    let finalClip: MediaRef;

    if (state.clips.length === 1) {
      // Pipeline 1-chunk + post (Smooth 24) — bez ffmpeg stitch
      finalClip = state.clips[0]!;
    } else {
      const stitchPrefix =
        state.engine === "wan"
          ? "studio/video-wan-stitched"
          : "studio/video-ltx-stitched";
      // Overlap drop w Comfy (ImageFromBatch index 1 dla chunk>0) —
      // stitch bez ffmpeg trim, żeby -c copy mógł działać.
      const result = await stitchComfyClips({
        clips: state.clips,
        fps: state.plan.fps,
        overlapFrames: 0,
        filenamePrefix: stitchPrefix,
      });
      finalClip = {
        filename: result.filename,
        subfolder: result.subfolder || "studio",
        type: result.type || "output",
      };
    }

    const wantRife = Boolean(state.body.postRife);
    const wantUpscale = Boolean(state.body.postUpscale);

    if (wantRife || wantUpscale) {
      const postStage = wantRife ? "rife" : "upscale";
      state.progress = emptyProgress({
        percent: percentForStage({ stage: postStage }) ?? 96,
        stage: postStage,
        phase: formatPolishPhase({ stage: postStage }),
      });
      state.advancingUntil = Date.now() + 600_000;
      await persist(state);

      const post = await runVideoPostProcess({
        clip: finalClip,
        sourceFps: state.plan.fps,
        postRife: wantRife,
        targetFps: 24,
        postUpscale: wantUpscale,
        filenamePrefix:
          state.engine === "wan"
            ? "studio/video-wan-post"
            : "studio/video-ltx-post",
      });
      finalClip = post.clip;
      state.postProcessWarnings = post.warnings;
      if (post.warnings.length) {
        state.promptBoostWarnings = [
          ...(state.promptBoostWarnings ?? []),
          ...post.warnings,
        ];
      }
    }

    state.outputs = [finalClip];
    state.status = "completed";
    const postNote =
      wantRife || wantUpscale
        ? state.postProcessWarnings?.length
          ? "gotowe (post częściowy)"
          : "gotowe (post)"
        : state.clips.length === 1
          ? "gotowe"
          : "gotowe (stitched)";
    state.progress = emptyProgress({
      percent: 100,
      stage: "done",
      phase: postNote,
    });
    state.advancingUntil = undefined;
    await persist(state);
    void recordGalleryOutputs(
      state.outputs.map((o) => ({
        filename: o.filename,
        subfolder: o.subfolder,
        type: o.type || "output",
      }))
    );
  } catch (err) {
    state.status = "failed";
    state.error = err instanceof Error ? err.message : "Stitch nieudany";
    state.progress = emptyProgress({
      percent: 100,
      stage: "fail",
      phase: formatPolishPhase({ stage: "fail" }),
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

  // Fast + lightx2v: wymuś 480p zanim plan chunków / persist stanu
  const geo = coerceWanFast480pGeometry({
    qualityPreset: rawBody.qualityPreset,
    wanDistillLora: rawBody.wanDistillLora,
    width: rawBody.width,
    height: rawBody.height,
    model: rawBody.model,
  });

  const body: GenerateBody = {
    ...rawBody,
    prompt: boost.modelPrompt,
    negativePrompt: boost.modelNegative,
    startImage: ensured.startImage,
    startImageSource: undefined,
    videoEngine: engine,
    ...(geo.locked
      ? { width: geo.width, height: geo.height, model: geo.model }
      : {}),
  };

  const videoPlan = planVideo(body);
  const plan = videoPlan.chunkPlan;
  const needsPost = Boolean(body.postRife || body.postUpscale);
  if (!plan) {
    throw new Error("Brak planu chunków dla pipeline");
  }
  // 1 chunk OK gdy Smooth 24 / upscale — wtedy finishStitch robi tylko post
  if (!plan.chunked && !needsPost) {
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
      stage: "queued",
      phase: formatPolishPhase({
        stage: "queued",
        engineLabel: engineLabelFromId(engine),
        chunkIndex: 1,
        chunkTotal: plan.chunkCount,
        queueAhead: 0,
      }),
      executionStartMs: Date.now(),
    }),
    modelPrompt: boost.modelPrompt,
    modelNegative: boost.modelNegative,
    promptBoostWarnings: boost.warnings,
  };

  await persist(state);
  await enqueueChunk(state, 0);

  const warnings = [...boost.warnings];
  if (geo.warning) warnings.push(geo.warning);
  if (!state.durableSavedAt) {
    warnings.push(
      "Nie zapisano stanu pipeline w Comfy input — po redeploy Vercel odzyskanie może się nie udać. Sprawdź COMFYUI_URL / upload."
    );
  }

  return {
    pipeline: state,
    warnings,
  };
}

/** Ostatni kick after() — unikaj multiplikacji pętli na każde poll GET. */
const recentBgKicks = new Map<string, number>();

/**
 * true gdy wolno odpalić after() kick (min. odstęp między kickami).
 * Legion worker (`PIPELINE_LEGION_WORKER=1`) — panel nie kickuje.
 */
export function shouldKickPipelineBackground(
  id: string,
  minIntervalMs = 45_000
): boolean {
  const last = recentBgKicks.get(id) ?? 0;
  return Date.now() - last >= minIntervalMs;
}

/**
 * Długi tick w tle (po odpowiedzi HTTP) — kontynuuje c1/stitch gdy UI padnie.
 * Zwraca Promise — `after(async () => await kick…)` musi czekać na pętlę,
 * inaczej Vercel kończy funkcję zanim fire-and-forget zdąży advance’ować.
 *
 * Budżet: Vercel maxDuration i tak ucina; durable JSON w Comfy input + GET
 * advance pozwalają klientowi / kolejnemu kickowi wznowić bez stall po c0.
 *
 * `PIPELINE_LEGION_WORKER=1` (opcjonalne, niezalecane domyślnie) — panel GET
 * tylko czyta; kick przez POST …/register. Nie mylić z niezależnym
 * `aigen-queue-worker.py` na Legionie.
 */
export async function kickPipelineBackground(
  id: string,
  budgetMs = 240_000
): Promise<void> {
  recentBgKicks.set(id, Date.now());
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

  const engineLabel = engineLabelFromId(state.engine);
  const chunkLabel =
    state.status === "stitching"
      ? formatPolishPhase({ stage: "stitch" })
      : state.status === "completed"
        ? null
        : state.progress.phase ||
          formatPolishPhase({
            stage: state.progress.stage ?? "running",
            engineLabel,
            chunkIndex: state.chunkIndex + 1,
            chunkTotal: state.plan.chunkCount,
            step: state.progress.step,
            stepMax: state.progress.stepMax,
            nodeType: state.progress.currentNodeType,
          });

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
