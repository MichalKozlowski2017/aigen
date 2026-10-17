"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import type { JobProgress } from "@/lib/studio/comfy-client";
import {
  DEFAULT_SDXL_NEGATIVE,
  DEFAULT_WAN_NEGATIVE,
  VIDEO_CAMERA_GUARD,
} from "@/lib/studio/defaults";
import {
  FLUX_MODEL_ID,
  isFluxModel,
  type ImageModelOption,
} from "@/lib/studio/flux";
import type { GalleryItem } from "@/lib/studio/types";
import {
  DEFAULT_VIDEO_ENGINE,
  LTX_UI_LIMITS,
  SVD_UI_LIMITS,
  VIDEO_ENGINE_OPTIONS,
  DEFAULT_WAN_FAST_STEPS,
  DEFAULT_WAN_QUALITY_PRESET,
  WAN_FPS_OPTIONS,
  WAN_QUALITY_PRESETS,
  WAN_QUALITY_PRESETS_UI,
  WAN_UI_LIMITS,
  isChunkedVideoEngine,
  planLtxVideo,
  planSvdVideo,
  planWanVideo,
  snapWanFps,
  type VideoEngineId,
  type WanQualityPresetId,
} from "@/lib/studio/workflow-builder";
import {
  DEFAULT_LTX_CHECKPOINT,
  DEFAULT_WAN_UNET,
  DEFAULT_WAN_UNET_720P,
} from "@/lib/studio/video-engines";
type JobOutput = {
  filename: string;
  subfolder: string;
  type: string;
};

/** Wan chunk ~15–20+ min; 2 chunki + stitch → długi deadline. */
const JOB_POLL_INTERVAL_MS = 2_000;
const JOB_POLL_MAX_MS = 90 * 60 * 1_000;
const PIPELINE_STORAGE_KEY = "aigen.videoPipeline";

type ErrorDetail = {
  message: string;
  hint?: string;
  linkHref?: string;
  linkLabel?: string;
  code?: string;
  details?: string;
  nodeErrors?: unknown;
  comfyError?: unknown;
};

type StartImageSource = {
  filename: string;
  subfolder?: string;
  type?: string;
};

type Props = {
  defaultModel: string;
  checkpoints: string[];
  /** Prefabrykowane opcje Obraz (Flux + SDXL + checkpointy). */
  imageModels?: ImageModelOption[];
  kind?: "image" | "video";
  videoLimitsNote?: string;
  imageLimitsNote?: string;
};

export function GenerateForm({
  defaultModel,
  checkpoints,
  imageModels,
  kind = "image",
  videoLimitsNote,
  imageLimitsNote,
}: Props) {
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState(defaultModel);
  const fluxSelected = kind === "image" && isFluxModel(model);
  const [negativePrompt, setNegativePrompt] = useState(
    kind === "image" && !isFluxModel(defaultModel) ? DEFAULT_SDXL_NEGATIVE : ""
  );
  const [videoEngine, setVideoEngine] = useState<VideoEngineId>(
    kind === "video" ? DEFAULT_VIDEO_ENGINE : "svd"
  );
  const [faceRestore, setFaceRestore] = useState(false);
  const [faceRestoreFidelity, setFaceRestoreFidelity] = useState(0.5);
  const [qualityPreset, setQualityPreset] = useState<WanQualityPresetId>(
    DEFAULT_WAN_QUALITY_PRESET
  );
  const [steps, setSteps] = useState<number>(DEFAULT_WAN_FAST_STEPS);
  /** Smooth 24: opcjonalny RIFE po stitch — nie jest domyślny ani mandatory. */
  const [postRife, setPostRife] = useState(false);
  const [postUpscale, setPostUpscale] = useState(false);
  const videoLimits =
    videoEngine === "wan"
      ? WAN_UI_LIMITS
      : videoEngine === "ltx"
        ? LTX_UI_LIMITS
        : SVD_UI_LIMITS;
  const [width, setWidth] = useState<number>(
    kind === "video" ? WAN_UI_LIMITS.defaultWidth : 1024
  );
  const [height, setHeight] = useState<number>(
    kind === "video" ? WAN_UI_LIMITS.defaultHeight : 1024
  );
  const [seed, setSeed] = useState(-1);
  const [batch, setBatch] = useState(1);
  const [durationSec, setDurationSec] = useState<number>(
    kind === "video" ? WAN_UI_LIMITS.defaultDurationSec : 2
  );
  const [fps, setFps] = useState<number>(
    kind === "video" ? WAN_UI_LIMITS.defaultFps : 6
  );
  const [startImage, setStartImage] = useState("");
  const [startImageSource, setStartImageSource] =
    useState<StartImageSource | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<ErrorDetail | null>(null);
  const [promptId, setPromptId] = useState<string | null>(null);
  /** Serwerowa orkiestracja Wan/LTX chunków — poll /api/video/pipeline/[id]. */
  const [pipelineId, setPipelineId] = useState<string | null>(() => {
    if (kind !== "video" || typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(PIPELINE_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as {
        pipelineId?: string;
        savedAt?: number;
      };
      if (!parsed.pipelineId) return null;
      if (parsed.savedAt && Date.now() - parsed.savedAt > JOB_POLL_MAX_MS) {
        window.localStorage.removeItem(PIPELINE_STORAGE_KEY);
        return null;
      }
      return parsed.pipelineId;
    } catch {
      return null;
    }
  });
  const [status, setStatus] = useState<string | null>(() =>
    // Wznów UI po odświeżeniu, gdy localStorage ma aktywny pipeline
    kind === "video" && typeof window !== "undefined"
      ? (() => {
          try {
            const raw = window.localStorage.getItem(PIPELINE_STORAGE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw) as { pipelineId?: string };
            return parsed.pipelineId ? "running" : null;
          } catch {
            return null;
          }
        })()
      : null
  );
  const [outputs, setOutputs] = useState<JobOutput[]>([]);
  const [jobProgress, setJobProgress] = useState<JobProgress | null>(null);
  const [nodesTotalHint, setNodesTotalHint] = useState<number | null>(null);
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [pending, startTransition] = useTransition();
  const [modelPromptPreview, setModelPromptPreview] = useState("");
  const [modelNegativePreview, setModelNegativePreview] = useState("");
  const [boostWarnings, setBoostWarnings] = useState<string[]>([]);
  const [boostBusy, setBoostBusy] = useState(false);
  const [boostOpen, setBoostOpen] = useState(true);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryItems, setGalleryItems] = useState<GalleryItem[]>([]);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const [galleryError, setGalleryError] = useState<string | null>(null);
  const [pollWarning, setPollWarning] = useState<string | null>(null);

  const videoPlan =
    kind === "video"
      ? videoEngine === "wan"
        ? planWanVideo({ width, height, fps, durationSec })
        : videoEngine === "ltx"
          ? planLtxVideo({ width, height, fps, durationSec })
          : planSvdVideo({ width, height, fps, durationSec })
      : null;
  const videoRisky = Boolean(videoPlan?.vramRisky);
  const durationInputMax = videoLimits.maxDurationSec;
  const [chunkInfo, setChunkInfo] = useState<{
    index: number;
    total: number;
    label: string;
  } | null>(null);

  function pickWanModel(prefer720: boolean): string {
    if (prefer720) {
      return (
        checkpoints.find((c) =>
          c.toLowerCase().includes("wan2.1_i2v_720p")
        ) ??
        checkpoints.find((c) => c.toLowerCase().includes("720p") && c.toLowerCase().includes("wan")) ??
        DEFAULT_WAN_UNET_720P
      );
    }
    return (
      checkpoints.find((c) => c.toLowerCase().includes("wan2.1_i2v_480p")) ??
      checkpoints.find((c) => c.toLowerCase().includes("wan2.1_i2v")) ??
      checkpoints.find((c) => c.toLowerCase().includes("wan")) ??
      DEFAULT_WAN_UNET
    );
  }

  function applyWanPreset(id: WanQualityPresetId) {
    // smooth-24 → Fast + RIFE toggle (Smooth nie jest osobnym presetem UI)
    const resolved: WanQualityPresetId =
      id === "smooth-24" ? DEFAULT_WAN_QUALITY_PRESET : id;
    const preset = WAN_QUALITY_PRESETS.find((p) => p.id === resolved);
    if (!preset) return;
    const keepRife = id === "smooth-24" || (resolved === "fast-480p" && postRife);
    setQualityPreset(resolved);
    setVideoEngine("wan");
    setWidth(preset.width);
    setHeight(preset.height);
    setFps(preset.fps);
    setSteps(preset.steps);
    setFaceRestore(preset.faceRestore);
    setFaceRestoreFidelity(preset.faceRestoreFidelity);
    // Quality* wyłącza RIFE; Fast zachowuje opcjonalny toggle
    setPostRife(id === "smooth-24" ? true : resolved === "fast-480p" ? keepRife : false);
    setPostUpscale(false);
    setModel(pickWanModel(preset.width >= 1024 || preset.id === "quality-720p"));
    if (!negativePrompt.trim()) {
      setNegativePrompt(DEFAULT_WAN_NEGATIVE);
    }
  }

  function applyVideoEngine(next: VideoEngineId) {
    setVideoEngine(next);
    if (next === "wan") {
      applyWanPreset(DEFAULT_WAN_QUALITY_PRESET);
      setPostRife(false);
    } else if (next === "ltx") {
      setWidth(LTX_UI_LIMITS.defaultWidth);
      setHeight(LTX_UI_LIMITS.defaultHeight);
      setDurationSec(LTX_UI_LIMITS.defaultDurationSec);
      setFps(LTX_UI_LIMITS.defaultFps);
      setPostRife(false);
      setPostUpscale(false);
      if (!model.toLowerCase().includes("ltx")) {
        setModel(DEFAULT_LTX_CHECKPOINT);
      }
    } else {
      setWidth(SVD_UI_LIMITS.defaultWidth);
      setHeight(SVD_UI_LIMITS.defaultHeight);
      setDurationSec(SVD_UI_LIMITS.defaultDurationSec);
      setFps(SVD_UI_LIMITS.defaultFps);
      setPostRife(false);
      setPostUpscale(false);
      const svd =
        checkpoints.find((c) => c.toLowerCase().includes("svd")) ??
        "svd_xt.safetensors";
      setModel(svd);
    }
  }

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    if (kind !== "video" || !galleryOpen) return;
    let cancelled = false;
    void (async () => {
      setGalleryBusy(true);
      setGalleryError(null);
      try {
        const res = await fetch("/api/gallery?kind=image&limit=40");
        const data = await res.json();
        if (cancelled) return;
        if (!data.ok) {
          setGalleryError(data.error ?? "Nie udało się wczytać galerii");
          setGalleryItems([]);
          return;
        }
        setGalleryItems((data.items as GalleryItem[]) ?? []);
        if ((data.items ?? []).length === 0) {
          setGalleryError(
            data.error ?? "Galeria pusta — najpierw wygeneruj obraz."
          );
        }
      } catch {
        if (!cancelled) setGalleryError("Błąd sieci przy galerii");
      } finally {
        if (!cancelled) setGalleryBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, galleryOpen]);

  useEffect(() => {
    const trimmed = prompt.trim();
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (!trimmed) {
        if (cancelled) return;
        setModelPromptPreview("");
        setModelNegativePreview("");
        setBoostWarnings([]);
        setBoostBusy(false);
        return;
      }

      if (!cancelled) setBoostBusy(true);
      try {
        const res = await fetch("/api/prompt-boost", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            negativePrompt:
              kind === "video"
                ? negativePrompt.trim() || DEFAULT_WAN_NEGATIVE
                : negativePrompt,
            kind,
          }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!data.ok) {
          setBoostWarnings([data.error ?? "Nie udało się przygotować promptu EN"]);
          setModelPromptPreview(trimmed);
          return;
        }
        setModelPromptPreview(String(data.modelPrompt ?? ""));
        setModelNegativePreview(String(data.modelNegative ?? ""));
        setBoostWarnings(Array.isArray(data.warnings) ? data.warnings : []);
        if (data.translated || data.boosted || data.detectedPolish) {
          setBoostOpen(true);
        }
      } catch {
        if (!cancelled) {
          setBoostWarnings([
            "Podgląd EN niedostępny (sieć) — przy generacji użyję oryginału lub serwerowego boostu.",
          ]);
          setModelPromptPreview(trimmed);
        }
      } finally {
        if (!cancelled) setBoostBusy(false);
      }
    }, trimmed ? 450 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [prompt, negativePrompt, kind]);

  useEffect(() => {
    // Pipeline ma własny poller — nie dubluj /api/jobs.
    if (!promptId || pipelineId) return;
    let cancelled = false;
    let consecutiveErrors = 0;
    const started = Date.now();

    const tick = async () => {
      if (cancelled) return;
      if (Date.now() - started > JOB_POLL_MAX_MS) {
        setError(
          "Timeout odpytywania joba (Wan/LTX może trwać 15–20+ min/chunk). Odśwież i sprawdź galerię / Comfy."
        );
        return;
      }
      try {
        const res = await fetch(`/api/jobs/${encodeURIComponent(promptId)}`);
        const data = await res.json();
        if (cancelled) return;
        if (!data.ok) {
          consecutiveErrors += 1;
          setPollWarning(
            data.error ??
              `Błąd statusu (próba ${consecutiveErrors}) — ponawiam…`
          );
          window.setTimeout(tick, Math.min(15_000, JOB_POLL_INTERVAL_MS * consecutiveErrors));
          return;
        }
        consecutiveErrors = 0;
        setPollWarning(null);
        const job = data.job as {
          status: string;
          outputs?: JobOutput[];
          progress?: JobProgress;
        };
        setStatus(job.status);
        setOutputs(job.outputs ?? []);
        if (job.progress) {
          setJobProgress(job.progress);
          if (job.progress.errorMessage && job.status === "failed") {
            setErrorDetail({
              message: job.progress.errorMessage,
              hint: job.progress.errorHint ?? undefined,
              linkHref: job.progress.errorLinkHref ?? undefined,
              linkLabel: job.progress.errorLinkLabel ?? undefined,
            });
            setError(job.progress.errorMessage);
          }
        }
        if (job.status === "completed" || job.status === "failed") {
          return;
        }
        window.setTimeout(tick, JOB_POLL_INTERVAL_MS);
      } catch {
        if (cancelled) return;
        consecutiveErrors += 1;
        // Nie setError + stop — transient (tunel / GPU) nie może zabijać polla.
        setPollWarning(
          `Nie udało się odpytać joba (próba ${consecutiveErrors}) — ponawiam…`
        );
        window.setTimeout(
          tick,
          Math.min(20_000, JOB_POLL_INTERVAL_MS * (1 + consecutiveErrors))
        );
      }
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [promptId, pipelineId]);

  useEffect(() => {
    if (!pipelineId) return;
    let cancelled = false;
    let consecutiveErrors = 0;
    const started = Date.now();

    try {
      window.localStorage.setItem(
        PIPELINE_STORAGE_KEY,
        JSON.stringify({ pipelineId, savedAt: Date.now() })
      );
    } catch {
      // ignore
    }

    /** 404 / miss po cold start — nie hard-error na pierwszej odpowiedzi. */
    const PIPELINE_MISS_MAX = 10;
    let consecutiveMisses = 0;

    const tick = async () => {
      if (cancelled) return;
      setStartedAtMs((prev) => prev ?? started);
      if (Date.now() - started > JOB_POLL_MAX_MS) {
        setError(
          "Timeout pipeline wideo. Serwer mógł dokończyć stitch w tle — sprawdź galerię (video-*-stitched)."
        );
        return;
      }
      try {
        const res = await fetch(
          `/api/video/pipeline/${encodeURIComponent(pipelineId)}`
        );
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          recoverable?: boolean;
          code?: string;
          job?: {
            status: string;
            outputs?: JobOutput[];
            progress?: JobProgress;
            promptId?: string;
          };
          chunkInfo?: { index: number; total: number; label: string };
        };
        if (cancelled) return;

        const isMiss =
          res.status === 404 ||
          data.code === "PIPELINE_REHYDRATING" ||
          (typeof data.error === "string" &&
            /nie znaleziony|niedostępny|odzysk/i.test(data.error));

        if (!data.ok) {
          consecutiveErrors += 1;
          if (isMiss) {
            consecutiveMisses += 1;
            if (consecutiveMisses >= PIPELINE_MISS_MAX) {
              const msg =
                "Nie udało się odzyskać pipeline po cold start / redeploy (brak stanu w Comfy). Sprawdź galerię — chunk c0 mógł się dokończyć; ewentualnie uruchom generację ponownie.";
              setError(msg);
              setErrorDetail({
                message: msg,
                hint: "Stan pipeline jest kopiowany do Comfy input (aigen-pipeline-*.json). Jeśli Comfy był offline przy starcie, odzyskanie nie jest możliwe.",
              });
              setPollWarning(null);
              try {
                window.localStorage.removeItem(PIPELINE_STORAGE_KEY);
              } catch {
                // ignore
              }
              return;
            }
            setPollWarning(
              consecutiveMisses === 1
                ? "Odzyskiwanie stanu pipeline z Comfy (cold start / redeploy)…"
                : `Odzyskiwanie pipeline… próba ${consecutiveMisses}/${PIPELINE_MISS_MAX}`
            );
          } else {
            setPollWarning(
              data.error ??
                `Błąd pipeline (próba ${consecutiveErrors}) — ponawiam…`
            );
          }
          window.setTimeout(
            tick,
            Math.min(15_000, JOB_POLL_INTERVAL_MS * Math.max(1, consecutiveMisses || consecutiveErrors))
          );
          return;
        }

        consecutiveErrors = 0;
        consecutiveMisses = 0;
        setPollWarning(null);
        const job = data.job!;
        if (job.promptId) setPromptId(job.promptId);
        setStatus(job.status);
        setOutputs(job.outputs ?? []);
        if (job.progress) setJobProgress(job.progress);
        if (data.chunkInfo) {
          setChunkInfo(data.chunkInfo);
        } else if (job.status === "completed") {
          setChunkInfo(null);
        }
        if (job.status === "failed") {
          const msg =
            job.progress?.errorMessage ?? data.error ?? "Pipeline nieudany";
          setError(msg);
          setErrorDetail({
            message: msg,
            hint: job.progress?.errorHint ?? undefined,
          });
          try {
            window.localStorage.removeItem(PIPELINE_STORAGE_KEY);
          } catch {
            // ignore
          }
          return;
        }
        if (job.status === "completed") {
          try {
            window.localStorage.removeItem(PIPELINE_STORAGE_KEY);
          } catch {
            // ignore
          }
          return;
        }
        window.setTimeout(tick, JOB_POLL_INTERVAL_MS);
      } catch {
        if (cancelled) return;
        consecutiveErrors += 1;
        setPollWarning(
          `Nie udało się odpytać pipeline (próba ${consecutiveErrors}) — serwer i tak dociąga chunki; ponawiam…`
        );
        window.setTimeout(
          tick,
          Math.min(20_000, JOB_POLL_INTERVAL_MS * (1 + consecutiveErrors))
        );
      }
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [pipelineId]);

  useEffect(() => {
    if (
      (!promptId && !pipelineId) ||
      status === "completed" ||
      status === "failed"
    ) {
      return;
    }
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [promptId, pipelineId, status]);

  async function uploadStartFile(file: File) {
    setError(null);
    setErrorDetail(null);
    setUploadBusy(true);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    try {
      const body = new FormData();
      body.append("image", file);
      const res = await fetch("/api/upload", { method: "POST", body });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "Upload nieudany");
        setStartImage("");
        setStartImageSource(null);
        return;
      }
      // Basename z Comfy /upload/image (input) — ta sama nazwa idzie do LoadImage
      setStartImage(data.startImage as string);
      setStartImageSource({
        filename: (data.name as string) || (data.startImage as string),
        subfolder: "",
        type: "input",
      });
    } catch {
      setError("Błąd sieci przy uploadzie");
      setStartImage("");
      setStartImageSource(null);
    } finally {
      setUploadBusy(false);
    }
  }

  function onPickFile(file: File | undefined | null) {
    if (!file) return;
    if (!file.type.startsWith("image/") && !/\.(png|jpe?g|webp|gif)$/i.test(file.name)) {
      setError("Wybierz plik obrazu (PNG, JPEG, WebP, GIF)");
      return;
    }
    void uploadStartFile(file);
  }

  async function importGalleryAsStart(item: GalleryItem) {
    setError(null);
    setErrorDetail(null);
    setGalleryError(null);
    try {
      const res = await fetch(item.url);
      if (!res.ok) {
        throw new Error(`Pobieranie z galerii HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const file = new File([blob], item.name || "gallery-start.png", {
        type: blob.type || item.mime || "image/png",
      });
      // Re-upload do Comfy input — uploadStartFile ustawia source=input + basename
      await uploadStartFile(file);
      setGalleryOpen(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Nie udało się zaimportować obrazu z galerii"
      );
    }
  }

  function applyGenerateError(data: {
    error?: string;
    errorDetail?: ErrorDetail;
    nodeErrors?: unknown;
    comfyError?: unknown;
  }) {
    const detail = data.errorDetail;
    const nodeErrors = data.nodeErrors ?? detail?.nodeErrors;
    setErrorDetail({
      message: detail?.message ?? data.error ?? "Generacja nieudana",
      hint: detail?.hint,
      linkHref: detail?.linkHref,
      linkLabel: detail?.linkLabel,
      code: detail?.code,
      details:
        detail?.details ||
        (nodeErrors
          ? typeof nodeErrors === "string"
            ? nodeErrors
            : JSON.stringify(nodeErrors, null, 2)
          : undefined),
      nodeErrors,
      comfyError: data.comfyError ?? detail?.comfyError,
    });
    setError(data.error ?? detail?.message ?? "Generacja nieudana");
    setStatus(null);
    setStartedAtMs(null);
    setChunkInfo(null);
    setPipelineId(null);
    setPollWarning(null);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setErrorDetail(null);
    setPollWarning(null);
    setOutputs([]);
    setJobProgress(null);
    setNodesTotalHint(null);
    setStatus("queued");
    setPromptId(null);
    setPipelineId(null);
    setChunkInfo(null);
    setStartedAtMs(Date.now());

    if (kind === "video" && !startImage.trim()) {
      setError("Dodaj obraz startowy (upload powyżej) albo wpisz nazwę pliku w Comfy input.");
      setStatus(null);
      setStartedAtMs(null);
      return;
    }

    startTransition(async () => {
      try {
        const baseBody: Record<string, unknown> = {
          kind,
          prompt,
          negativePrompt:
            kind === "video"
              ? negativePrompt.trim() || DEFAULT_WAN_NEGATIVE
              : negativePrompt,
          model,
          width,
          height,
          seed,
          batch: kind === "image" ? batch : 1,
          ...(kind === "video" && videoEngine === "wan"
            ? { steps, qualityPreset }
            : {}),
        };

        const usePipeline =
          kind === "video" &&
          isChunkedVideoEngine(videoEngine) &&
          (Boolean(videoPlan?.chunkPlan?.chunked) || postRife || postUpscale);

        // ——— Wan/LTX: serwerowy pipeline (chunki + opcjonalnie RIFE/upscale) ———
        if (usePipeline) {
          const plan = videoPlan!.chunkPlan!;
          setChunkInfo({
            index: 1,
            total: plan.chunkCount,
            label: plan.chunked
              ? `chunk 1/${plan.chunkCount} (serwer orkiestruje ${plan.chunkCount} odcinki + stitch${
                  postRife || postUpscale ? " + post" : ""
                })`
              : `1 chunk + post (${postRife ? "RIFE" : ""}${
                  postRife && postUpscale ? "+" : ""
                }${postUpscale ? "upscale" : ""})`,
          });
          setJobProgress({
            percent: 2,
            phase: `chunk 1/${plan.chunkCount}`,
            queuePending: 0,
            queueRunning: false,
            currentNodeId: null,
            currentNodeType: null,
            nodesDone: null,
            nodesTotal: null,
            executionStartMs: Date.now(),
            errorMessage: null,
            errorHint: null,
            errorLinkHref: null,
            errorLinkLabel: null,
          });

          const body = {
            ...baseBody,
            durationSec,
            fps: videoEngine === "wan" ? snapWanFps(fps) : fps,
            startImage: startImage.trim(),
            videoEngine,
            faceRestore,
            faceRestoreFidelity,
            postRife,
            postUpscale,
            ...(startImageSource ? { startImageSource } : {}),
          };

          const res = await fetch("/api/video/pipeline", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const data = await res.json();
          if (!data.ok) {
            applyGenerateError(data);
            return;
          }
          if (typeof data.modelPrompt === "string" && data.modelPrompt) {
            setModelPromptPreview(data.modelPrompt);
            setBoostOpen(true);
          }
          if (typeof data.modelNegative === "string") {
            setModelNegativePreview(data.modelNegative);
          }
          if (data.promptBoost?.warnings?.length) {
            setBoostWarnings(data.promptBoost.warnings);
          }
          if (data.chunkInfo) {
            setChunkInfo(
              data.chunkInfo as { index: number; total: number; label: string }
            );
          }
          setPipelineId(data.pipelineId as string);
          if (typeof data.promptId === "string") {
            setPromptId(data.promptId);
          }
          setStatus("queued");
          return;
        }

        // ——— Pojedynczy job (obraz / SVD / Wan|LTX ≤ SAFE) ———
        const body: Record<string, unknown> = { ...baseBody };
        if (kind === "video") {
          body.durationSec = durationSec;
          body.fps = videoEngine === "wan" ? snapWanFps(fps) : fps;
          body.startImage = startImage.trim();
          body.videoEngine = videoEngine;
          body.faceRestore = faceRestore;
          body.faceRestoreFidelity = faceRestoreFidelity;
          body.postRife = postRife;
          body.postUpscale = postUpscale;
          if (videoEngine === "wan") {
            body.steps = steps;
            body.qualityPreset = qualityPreset;
          }
          if (
            isChunkedVideoEngine(videoEngine) &&
            videoPlan?.chunkPlan?.chunks[0]
          ) {
            body.ltxChunkLength = videoPlan.chunkPlan.chunks[0].length;
            body.ltxSaveTail = false;
            body.ltxChunkIndex = 0;
          }
          if (startImageSource) {
            body.startImageSource = startImageSource;
          }
        }
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!data.ok) {
          applyGenerateError(data);
          return;
        }
        if (typeof data.modelPrompt === "string" && data.modelPrompt) {
          setModelPromptPreview(data.modelPrompt);
          setBoostOpen(true);
        }
        if (typeof data.modelNegative === "string") {
          setModelNegativePreview(data.modelNegative);
        }
        if (data.promptBoost?.warnings?.length) {
          setBoostWarnings(data.promptBoost.warnings);
        }
        if (typeof data.nodesTotal === "number") {
          setNodesTotalHint(data.nodesTotal);
        }
        setPromptId(data.promptId);
        setJobProgress({
          percent: 5,
          phase: "w kolejce",
          queuePending: 0,
          queueRunning: false,
          currentNodeId: null,
          currentNodeType: null,
          nodesDone: null,
          nodesTotal: typeof data.nodesTotal === "number" ? data.nodesTotal : null,
          executionStartMs: Date.now(),
          errorMessage: null,
          errorHint: null,
          errorLinkHref: null,
          errorLinkLabel: null,
        });
      } catch {
        setError("Błąd sieci");
        setStatus(null);
        setStartedAtMs(null);
      }
    });
  }

  const modelOptions: ImageModelOption[] =
    kind === "image" && imageModels && imageModels.length > 0
      ? imageModels
      : (() => {
          const values =
            checkpoints.length > 0
              ? Array.from(new Set([defaultModel, ...checkpoints]))
              : [defaultModel];
          // Upewnij się, że 480p/720p Wan są na liście nawet gdy Comfy offline
          if (kind === "video" && videoEngine === "wan") {
            for (const wanName of [DEFAULT_WAN_UNET, DEFAULT_WAN_UNET_720P]) {
              if (!values.includes(wanName)) values.push(wanName);
            }
          }
          return values.map((value) => ({
            value,
            label:
              value === FLUX_MODEL_ID
                ? "Flux.2 Dev (fp8)"
                : value.toLowerCase().includes("wan2.1_i2v_720p")
                  ? "Wan 2.1 I2V 720p FP8"
                  : value.toLowerCase().includes("wan2.1_i2v_480p")
                    ? "Wan 2.1 I2V 480p FP8"
                    : value,
            engine: isFluxModel(value) ? ("flux" as const) : ("sdxl" as const),
          }));
        })();

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <form onSubmit={onSubmit} className="studio-fade-in space-y-5">
        {kind === "video" ? (
          <div className="space-y-3">
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium uppercase tracking-[0.16em] text-stone-500">
                Silnik wideo
              </legend>
              <div className="flex flex-wrap gap-2">
                {VIDEO_ENGINE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => applyVideoEngine(opt.id)}
                    className={[
                      "rounded-lg border px-3 py-2 text-left text-sm transition",
                      videoEngine === opt.id
                        ? "border-teal-400/50 bg-teal-400/10 text-teal-50"
                        : "border-white/10 bg-white/[0.03] text-stone-300 hover:border-white/20",
                    ].join(" ")}
                  >
                    <span className="block font-medium">{opt.label}</span>
                    <span className="mt-0.5 block text-[11px] text-stone-500">
                      {opt.blurb}
                    </span>
                  </button>
                ))}
              </div>
              {videoEngine === "wan" ? (
                <p className="rounded-lg border border-teal-400/20 bg-teal-400/5 px-3 py-2 text-[12px] leading-relaxed text-teal-100/85">
                  <span className="font-medium text-teal-50">
                    fotoreal / wolniej / offload
                  </span>
                  {" — "}
                  Domyślnie <strong className="font-medium text-teal-50">Fast 480p</strong>{" "}
                  (832×480 · 16 fps · steps ~{DEFAULT_WAN_FAST_STEPS}). Quality
                  720p zostaje opcjonalnie — wolne na 16 GB. Smooth 24 = toggle
                  RIFE poniżej (nie mandatory).
                </p>
              ) : null}
            </fieldset>

            {videoEngine === "wan" ? (
              <fieldset className="space-y-2">
                <legend className="text-xs font-medium uppercase tracking-[0.16em] text-stone-500">
                  Preset jakości
                </legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {WAN_QUALITY_PRESETS_UI.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => applyWanPreset(p.id)}
                      className={[
                        "rounded-lg border px-3 py-2 text-left text-sm transition",
                        qualityPreset === p.id
                          ? "border-amber-400/45 bg-amber-400/10 text-amber-50"
                          : "border-white/10 bg-white/[0.03] text-stone-300 hover:border-white/20",
                      ].join(" ")}
                    >
                      <span className="block font-medium">{p.label}</span>
                      <span className="mt-0.5 block text-[11px] text-stone-500">
                        {p.blurb}
                      </span>
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-stone-500">
                  Prompt guard:{" "}
                  <span className="text-stone-400">{VIDEO_CAMERA_GUARD}</span>
                  . Negatyw domyślny: morphing hands / zoom-in / camera shake.
                </p>
              </fieldset>
            ) : null}

            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5">
              <input
                type="checkbox"
                checked={faceRestore}
                onChange={(e) => setFaceRestore(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="block text-sm text-stone-200">
                  Face restore (CodeFormer)
                  {faceRestore && faceRestoreFidelity < 0.45 ? (
                    <span className="ml-1 text-amber-200/80">· mocniejszy</span>
                  ) : null}
                </span>
                <span className="block text-[11px] text-stone-500">
                  Per chunk. Wymaga facerestore_cf + codeformer.pth na Legionie.
                  Quality preset ustawia silniejszy restore.
                </span>
              </span>
            </label>

            {videoEngine === "wan" ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="flex flex-1 cursor-pointer items-start gap-2.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={postRife}
                    onChange={(e) => {
                      setPostRife(e.target.checked);
                      // Smooth 24 = Fast + RIFE; nie przełączaj na osobny preset
                      if (
                        e.target.checked &&
                        (qualityPreset === "quality-720p" ||
                          qualityPreset === "quality-24-native")
                      ) {
                        applyWanPreset(DEFAULT_WAN_QUALITY_PRESET);
                        setPostRife(true);
                      }
                    }}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-sm text-stone-200">
                      Smooth 24 (RIFE) — opcjonalnie
                    </span>
                    <span className="block text-[11px] text-stone-500">
                      Gen @16 → RIFE 24 po stitch. Wyłączone domyślnie; graceful
                      gdy brak node’a.
                    </span>
                  </span>
                </label>
                <label className="flex flex-1 cursor-pointer items-start gap-2.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={postUpscale}
                    onChange={(e) => setPostUpscale(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-sm text-stone-200">
                      Post upscale 2×
                    </span>
                    <span className="block text-[11px] text-stone-500">
                      RealESRGAN po stitch (opcjonalnie).
                    </span>
                  </span>
                </label>
              </div>
            ) : null}

            <label className="block text-xs font-medium uppercase tracking-[0.16em] text-stone-500">
              Obraz startowy
            </label>
            <div
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragEnter={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setDragOver(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                onPickFile(e.dataTransfer.files?.[0]);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`cursor-pointer rounded-xl border border-dashed px-4 py-6 transition ${
                dragOver
                  ? "border-teal-400/60 bg-teal-400/10"
                  : "border-white/15 bg-white/[0.03] hover:border-teal-400/35"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif"
                className="hidden"
                onChange={(e) => {
                  onPickFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
                {previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewUrl}
                    alt="Podgląd obrazu startowego"
                    className="h-24 w-24 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-black/20 text-xs text-stone-500">
                    SVD
                  </div>
                )}
                <div className="min-w-0 space-y-1">
                  <p className="text-sm text-stone-200">
                    {uploadBusy
                      ? "Wgrywam do ComfyUI…"
                      : startImage
                        ? `Gotowe: ${startImage}`
                        : "Upuść obraz tutaj albo kliknij, by wybrać plik"}
                  </p>
                  <p className="text-xs text-stone-500">
                    Plik trafia do folderu input ComfyUI i staje się klatką startową SVD.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setGalleryOpen((v) => !v)}
                className="rounded-lg border border-white/12 px-3 py-2 text-sm text-stone-200 hover:border-teal-400/40 hover:text-teal-100"
              >
                {galleryOpen ? "Ukryj galerię" : "Z galerii"}
              </button>
            </div>

            {galleryOpen ? (
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <p className="mb-2 text-xs uppercase tracking-[0.16em] text-stone-500">
                  Wybierz obraz startowy z Galerii
                </p>
                {galleryBusy ? (
                  <p className="text-sm text-stone-500">Ładuję…</p>
                ) : null}
                {galleryError ? (
                  <p className="text-sm text-amber-200/80">{galleryError}</p>
                ) : null}
                <ul className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
                  {galleryItems.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        disabled={uploadBusy}
                        onClick={() => void importGalleryAsStart(item)}
                        className="group block w-full overflow-hidden rounded-lg border border-white/10 bg-black/30 text-left hover:border-teal-400/50 disabled:opacity-50"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={item.url}
                          alt={item.name}
                          className="aspect-square w-full object-cover opacity-90 transition group-hover:opacity-100"
                        />
                        <span className="block truncate px-1.5 py-1 text-[10px] text-stone-500">
                          {item.name}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <Field label="Albo nazwa już w Comfy input">
              <input
                type="text"
                value={startImage}
                onChange={(e) => {
                  setStartImage(e.target.value);
                  setStartImageSource(null);
                }}
                placeholder="np. start.png"
                className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm"
              />
            </Field>
          </div>
        ) : null}

        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-[0.16em] text-stone-500">
            Prompt
          </label>
          <textarea
            required
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={5}
            className="w-full resize-y rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-stone-100 outline-none ring-teal-400/0 transition focus:border-teal-400/40 focus:ring-2 focus:ring-teal-400/20"
            placeholder={
              kind === "video"
                ? "Opis ruchu / klimatu po polsku (SVD: głównie obraz startowy; prompt i tak idzie przez boost EN)…"
                : "Opisz obraz po polsku…"
            }
          />
          {prompt.trim() ? (
            <details
              open={boostOpen}
              onToggle={(e) => setBoostOpen((e.target as HTMLDetailsElement).open)}
              className="mt-2 rounded-lg border border-white/8 bg-black/20 px-3 py-2"
            >
              <summary className="cursor-pointer select-none text-xs text-stone-400">
                Prompt do modelu (EN)
                {boostBusy ? (
                  <span className="ml-2 text-stone-600">aktualizuję…</span>
                ) : null}
              </summary>
              <p className="mt-2 whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-stone-300">
                {modelPromptPreview || "—"}
              </p>
              {kind === "image" &&
              modelNegativePreview &&
              modelNegativePreview !== negativePrompt.trim() ? (
                <p className="mt-2 text-[11px] leading-relaxed text-stone-500">
                  <span className="uppercase tracking-wider text-stone-600">
                    Negatyw (EN):{" "}
                  </span>
                  {modelNegativePreview}
                </p>
              ) : null}
              {boostWarnings.length > 0 ? (
                <p className="mt-2 text-[11px] text-amber-200/80" role="status">
                  {boostWarnings.join(" ")}
                </p>
              ) : null}
            </details>
          ) : null}
        </div>

        {(kind === "image" && !fluxSelected) || kind === "video" ? (
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-[0.16em] text-stone-500">
              Negatyw
            </label>
            <textarea
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              rows={kind === "video" ? 3 : 2}
              placeholder={
                kind === "video"
                  ? DEFAULT_WAN_NEGATIVE
                  : DEFAULT_SDXL_NEGATIVE
              }
              className="w-full resize-y rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-stone-100 outline-none focus:border-teal-400/40 focus:ring-2 focus:ring-teal-400/20"
            />
            {kind === "video" ? (
              <p className="mt-1 text-[11px] text-stone-500">
                Puste = domyślny Wan (hands / zoom / shake). Serwer i tak dociąga
                brakujące tokeny.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Model">
            <select
              value={model}
              onChange={(e) => {
                const next = e.target.value;
                setModel(next);
                if (kind === "image") {
                  if (isFluxModel(next)) {
                    setNegativePrompt("");
                  } else if (!negativePrompt.trim()) {
                    setNegativePrompt(DEFAULT_SDXL_NEGATIVE);
                  }
                }
              }}
              className="w-full rounded-lg border border-white/10 bg-[#0b1614] px-3 py-2 text-sm"
            >
              {modelOptions.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Seed (−1 = losowy)">
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value))}
              className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Szerokość">
            <input
              type="number"
              min={256}
              max={kind === "video" ? videoLimits.maxWidth : 2048}
              step={
                kind === "video"
                  ? videoEngine === "ltx"
                    ? 32
                    : videoEngine === "wan"
                      ? 16
                      : 64
                  : 64
              }
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
              className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Wysokość">
            <input
              type="number"
              min={256}
              max={kind === "video" ? videoLimits.maxHeight : 2048}
              step={
                kind === "video"
                  ? videoEngine === "ltx"
                    ? 32
                    : videoEngine === "wan"
                      ? 16
                      : 64
                  : 64
              }
              value={height}
              onChange={(e) => setHeight(Number(e.target.value))}
              className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm"
            />
          </Field>
          {kind === "image" ? (
            <Field label="Batch">
              <input
                type="number"
                min={1}
                max={4}
                value={batch}
                onChange={(e) => setBatch(Number(e.target.value))}
                className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm"
              />
            </Field>
          ) : (
            <>
              <Field
                label={`Czas zadany (s, max ${durationInputMax} @ ${fps} FPS)`}
              >
                <input
                  type="number"
                  min={1}
                  max={durationInputMax}
                  step={0.5}
                  value={durationSec}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setDurationSec(Math.min(next, durationInputMax));
                  }}
                  className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm"
                />
              </Field>
              {videoEngine === "wan" ? (
                <Field label="FPS (16 | 24)">
                  <select
                    value={snapWanFps(fps)}
                    onChange={(e) => setFps(Number(e.target.value))}
                    className="w-full rounded-lg border border-white/10 bg-[#0b1614] px-3 py-2 text-sm"
                  >
                    {WAN_FPS_OPTIONS.map((f) => (
                      <option key={f} value={f}>
                        {f} fps
                        {f === 24 ? " · native (~3 chunki @10s)" : " · Fast / Smooth"}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <Field label={`FPS (max ${videoLimits.maxFps})`}>
                  <input
                    type="number"
                    min={1}
                    max={videoLimits.maxFps}
                    value={fps}
                    onChange={(e) => setFps(Number(e.target.value))}
                    className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm"
                  />
                </Field>
              )}
              {videoEngine === "wan" ? (
                <Field label="Steps">
                  <input
                    type="number"
                    min={4}
                    max={40}
                    value={steps}
                    onChange={(e) => setSteps(Number(e.target.value))}
                    className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm"
                  />
                </Field>
              ) : null}
            </>
          )}
        </div>

        {kind === "video" && videoPlan ? (
          <div className="space-y-1.5 text-sm">
            <p className="text-stone-200">
              Wyjdzie{" "}
              <span className="font-mono text-teal-100">
                {videoPlan.effectiveDurationSec}s
              </span>{" "}
              (
              <span className="font-mono">{videoPlan.frames}</span> klatek @{" "}
              <span className="font-mono">{videoPlan.fps}</span> FPS)
              {isChunkedVideoEngine(videoEngine) &&
              videoPlan.chunkPlan?.chunked ? (
                <span className="text-teal-100/80">
                  {" "}
                  · {videoPlan.chunkPlan.chunkCount} chunków (overlap{" "}
                  {videoPlan.chunkPlan.overlap} + stitch)
                </span>
              ) : videoEngine === "wan" ? (
                <span className="text-stone-500">
                  {" "}
                  · 1 chunk · Wan length 4n+1 (≤{WAN_UI_LIMITS.maxLength})
                </span>
              ) : videoEngine === "ltx" ? (
                <span className="text-stone-500">
                  {" "}
                  · 1 chunk · LTX length 8n+1 (≤{LTX_UI_LIMITS.maxLength})
                </span>
              ) : null}
            </p>
            {videoPlan.durationClamped ? (
              <p className="text-amber-200/85">
                Zadany czas przekracza max{" "}
                {isChunkedVideoEngine(videoEngine)
                  ? videoLimits.maxDurationSec
                  : videoPlan.maxDurationAtFps}
                s
                {isChunkedVideoEngine(videoEngine)
                  ? ` (chunki ≤${
                      videoEngine === "wan"
                        ? WAN_UI_LIMITS.maxLength
                        : LTX_UI_LIMITS.maxLength
                    } klatek)`
                  : ` przy ${videoPlan.fps} FPS`}{" "}
                — wysyłamy {videoPlan.frames} klatek /{" "}
                {videoPlan.effectiveDurationSec}s
                {videoPlan.chunkPlan?.chunked
                  ? ` w ${videoPlan.chunkPlan.chunkCount} odcinkach`
                  : ""}
                .
              </p>
            ) : null}
            {videoLimitsNote ? (
              <p className="text-stone-500">{videoLimitsNote}</p>
            ) : null}
            <p className="text-stone-500">
              Start frame w Comfy <code className="text-stone-400">input</code> —
              upload / „Z galerii”.{" "}
              {videoEngine === "wan"
                ? WAN_UI_LIMITS.note
                : videoEngine === "ltx"
                  ? LTX_UI_LIMITS.note
                  : SVD_UI_LIMITS.note}
            </p>
            {videoRisky ? (
              <p className="text-amber-200/85">
                {videoEngine === "wan"
                  ? `Uwaga VRAM (~16 GB): SAFE ${WAN_UI_LIMITS.maxLength} klatek/chunk (4n+1). 720p / dłuższe chunki = więcej offloadu; @24fps/10s ≈3 odcinki.`
                  : videoEngine === "ltx"
                    ? `Uwaga VRAM (~16 GB): chunk >~${LTX_UI_LIMITS.comfortLength} klatek — Legion SAFE to ${LTX_UI_LIMITS.maxLength} @ 768×512; dłuższe wideo idzie chunkami.`
                    : `Uwaga VRAM (~16 GB): SVD powyżej ~${SVD_UI_LIMITS.comfortFrames} klatek często OOM.`}
              </p>
            ) : null}
            {videoEngine === "wan" && postRife ? (
              <p className="text-teal-100/75">
                Smooth 24: generacja @ {fps} fps → RIFE po stitch do 24 fps
                (graceful, jeśli brak node’a na Legionie).
              </p>
            ) : null}
          </div>
        ) : null}

        {kind === "image" && fluxSelected && imageLimitsNote ? (
          <p className="text-sm text-amber-200/70">{imageLimitsNote}</p>
        ) : null}

        {error || errorDetail ? (
          <div className="space-y-1.5 rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2.5" role="alert">
            <p className="text-sm text-rose-200">
              {errorDetail?.message ?? error}
            </p>
            {errorDetail?.hint ? (
              <p className="text-sm text-rose-100/70">{errorDetail.hint}</p>
            ) : null}
            {errorDetail?.details ? (
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 font-mono text-[11px] leading-snug text-rose-100/80">
                {errorDetail.details}
              </pre>
            ) : null}
            {errorDetail?.linkHref ? (
              <a
                href={errorDetail.linkHref}
                target="_blank"
                rel="noreferrer"
                className="inline-block text-sm text-teal-200 underline-offset-2 hover:underline"
              >
                {errorDetail.linkLabel ?? errorDetail.linkHref}
              </a>
            ) : null}
          </div>
        ) : null}

        {pollWarning && !error ? (
          <p className="rounded-lg border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-sm text-amber-100/90">
            {pollWarning}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending || uploadBusy}
            className="studio-cta rounded-lg bg-teal-400 px-5 py-2.5 text-sm font-semibold text-[#04201a] transition hover:bg-teal-300 disabled:opacity-60"
          >
            {pending
              ? chunkInfo
                ? `Chunk ${chunkInfo.index}/${chunkInfo.total}…`
                : "Kolejkuję…"
              : pipelineId && status && status !== "completed" && status !== "failed"
                ? chunkInfo
                  ? `Pipeline ${chunkInfo.index}/${chunkInfo.total}…`
                  : "Pipeline…"
                : kind === "video"
                  ? "Generuj wideo"
                  : "Generuj obraz"}
          </button>
          <Link
            href="/gallery"
            className="text-sm text-stone-400 underline-offset-2 hover:text-stone-200 hover:underline"
          >
            Galeria
          </Link>
        </div>
      </form>

      <div className="studio-fade-in-delayed space-y-4">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-stone-500">
          Podgląd
        </p>
        <div className="relative min-h-[280px] overflow-hidden rounded-xl border border-dashed border-white/10 bg-gradient-to-br from-white/[0.03] to-transparent p-4">
          {status || pending ? (
            <GenerationProgressPanel
              status={status}
              promptId={promptId}
              pipelineId={pipelineId}
              progress={jobProgress}
              nodesTotalHint={nodesTotalHint}
              startedAtMs={startedAtMs}
              nowMs={nowMs}
              chunkInfo={chunkInfo}
            />
          ) : (
            <p className="text-sm text-stone-500">
              Wynik pojawi się tutaj po zakończeniu joba w ComfyUI.
            </p>
          )}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {outputs.map((o) => {
              const q = new URLSearchParams({
                filename: o.filename,
                subfolder: o.subfolder || "",
                type: o.type || "output",
              });
              const src = `/api/comfy-view?${q.toString()}`;
              const isVideo = /\.(mp4|webm|mov)$/i.test(o.filename);
              return (
                <div
                  key={`${o.subfolder}/${o.filename}`}
                  className="space-y-2 overflow-hidden rounded-lg"
                >
                  {isVideo ? (
                    <video
                      src={src}
                      controls
                      playsInline
                      preload="metadata"
                      className="w-full bg-black/40"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={src} alt={o.filename} className="w-full object-cover" />
                  )}
                  <a
                    href={src}
                    download={o.filename}
                    className="inline-block text-xs text-teal-200/90 underline-offset-2 hover:underline"
                  >
                    Pobierz {o.filename}
                  </a>
                </div>
              );
            })}
          </div>
          {status === "completed" && outputs.length > 0 ? (
            <div className="mt-4 space-y-2 rounded-lg border border-teal-400/20 bg-teal-400/5 px-3 py-3">
              <p className="text-sm text-teal-100/90">
                Zapisane w output ComfyUI — widać je w Galerii (historia / katalog
                output).
              </p>
              <Link
                href="/gallery"
                className="inline-flex rounded-lg bg-teal-400 px-3 py-1.5 text-sm font-semibold text-[#04201a] hover:bg-teal-300"
              >
                Otwórz Galerię
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium uppercase tracking-[0.16em] text-stone-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}:${String(r).padStart(2, "0")}` : `${r}s`;
}

function GenerationProgressPanel({
  status,
  promptId,
  pipelineId,
  progress,
  nodesTotalHint,
  startedAtMs,
  nowMs,
  chunkInfo,
}: {
  status: string | null;
  promptId: string | null;
  pipelineId: string | null;
  progress: JobProgress | null;
  nodesTotalHint: number | null;
  startedAtMs: number | null;
  nowMs: number;
  chunkInfo: { index: number; total: number; label: string } | null;
}) {
  const nodesTotal = progress?.nodesTotal ?? nodesTotalHint;
  const nodesDone = progress?.nodesDone;
  const start = startedAtMs;
  const elapsed = start ? nowMs - start : null;

  let percent = progress?.percent;
  if (chunkInfo && status !== "completed" && status !== "failed") {
    const base = ((chunkInfo.index - 1) / chunkInfo.total) * 100;
    const within =
      progress?.percent != null
        ? (progress.percent / 100) * (100 / chunkInfo.total)
        : 0;
    percent = Math.min(99, Math.round(base + within));
  }
  if (percent == null && status === "queued") percent = 8;
  if (percent == null && status === "running") {
    percent =
      nodesTotal && nodesDone != null
        ? Math.min(95, Math.round((nodesDone / nodesTotal) * 100))
        : elapsed != null
          ? Math.min(85, 15 + Math.floor(elapsed / 1000))
          : null;
  }
  if (status === "completed") percent = 100;
  if (status === "failed") percent = 100;

  const indeterminate =
    percent == null && (status === "running" || status === "queued");
  const width = percent != null ? `${percent}%` : indeterminate ? "40%" : "0%";
  const phaseLabel =
    chunkInfo?.label || progress?.phase || status || "…";

  return (
    <div className="mb-3 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-stone-400">
          Status:{" "}
          <span className="text-teal-200">{phaseLabel}</span>
          {status &&
          !chunkInfo &&
          progress?.phase &&
          status !== progress.phase ? (
            <span className="ml-1 text-stone-600">({status})</span>
          ) : null}
        </p>
        <p className="font-mono text-xs text-stone-500">
          {percent != null ? `${percent}%` : "…"}
          {elapsed != null ? ` · ${formatElapsed(elapsed)}` : null}
        </p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className={[
            "h-full rounded-full bg-teal-400 transition-[width] duration-500",
            indeterminate ? "animate-pulse" : "",
            status === "failed" ? "bg-rose-400" : "",
          ].join(" ")}
          style={{ width }}
        />
      </div>
      <dl className="grid gap-1 text-[11px] text-stone-500 sm:grid-cols-2">
        {chunkInfo ? (
          <div>
            <dt className="inline text-stone-600">chunk · </dt>
            <dd className="inline font-mono text-stone-400">
              {chunkInfo.index}/{chunkInfo.total}
            </dd>
          </div>
        ) : null}
        {pipelineId ? (
          <div className="sm:col-span-2">
            <dt className="inline text-stone-600">pipeline · </dt>
            <dd className="inline font-mono text-stone-400">{pipelineId}</dd>
          </div>
        ) : null}
        {promptId ? (
          <div>
            <dt className="inline text-stone-600">prompt_id · </dt>
            <dd className="inline font-mono text-stone-400">{promptId}</dd>
          </div>
        ) : null}
        {nodesTotal != null ? (
          <div>
            <dt className="inline text-stone-600">nody · </dt>
            <dd className="inline font-mono text-stone-400">
              {nodesDone != null ? `${nodesDone}/` : ""}
              {nodesTotal}
            </dd>
          </div>
        ) : null}
        {progress?.currentNodeId || progress?.currentNodeType ? (
          <div className="sm:col-span-2">
            <dt className="inline text-stone-600">node · </dt>
            <dd className="inline font-mono text-stone-400">
              {progress.currentNodeType ?? "?"}
              {progress.currentNodeId ? ` (#${progress.currentNodeId})` : ""}
            </dd>
          </div>
        ) : null}
        {progress && (progress.queuePending > 0 || progress.queueRunning) ? (
          <div>
            <dt className="inline text-stone-600">kolejka · </dt>
            <dd className="inline text-stone-400">
              {progress.queueRunning ? "running" : "pending"}
              {progress.queuePending > 0
                ? ` · pending ${progress.queuePending}`
                : ""}
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
