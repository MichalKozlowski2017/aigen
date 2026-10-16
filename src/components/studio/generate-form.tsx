"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import type { JobProgress } from "@/lib/studio/comfy-client";
import { DEFAULT_SDXL_NEGATIVE } from "@/lib/studio/defaults";
import {
  FLUX_MODEL_ID,
  isFluxModel,
  type ImageModelOption,
} from "@/lib/studio/flux";
import type { GalleryItem } from "@/lib/studio/types";
import {
  VIDEO_UI_LIMITS,
  estimateVideoFrames,
} from "@/lib/studio/workflow-builder";

type JobOutput = {
  filename: string;
  subfolder: string;
  type: string;
};

type ErrorDetail = {
  message: string;
  hint?: string;
  linkHref?: string;
  linkLabel?: string;
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
  const [width, setWidth] = useState(kind === "video" ? 512 : 1024);
  const [height, setHeight] = useState(kind === "video" ? 512 : 1024);
  const [seed, setSeed] = useState(-1);
  const [batch, setBatch] = useState(1);
  const [durationSec, setDurationSec] = useState(2);
  const [fps, setFps] = useState(6);
  const [startImage, setStartImage] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<ErrorDetail | null>(null);
  const [promptId, setPromptId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
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

  const videoFrames = estimateVideoFrames(durationSec, fps);
  const videoRisky =
    kind === "video" &&
    (durationSec > VIDEO_UI_LIMITS.comfortDurationSec ||
      fps > VIDEO_UI_LIMITS.comfortFps ||
      videoFrames > VIDEO_UI_LIMITS.comfortFrames);

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
            negativePrompt: kind === "image" ? negativePrompt : "",
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
    if (!promptId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/jobs/${encodeURIComponent(promptId)}`);
        const data = await res.json();
        if (cancelled) return;
        if (!data.ok) {
          setError(data.error ?? "Błąd statusu");
          return;
        }
        const job = data.job as {
          status: string;
          outputs?: JobOutput[];
          progress?: JobProgress;
        };
        setStatus(job.status);
        setOutputs(job.outputs ?? []);
        if (job.progress) {
          setJobProgress(job.progress);
          if (job.progress.errorMessage) {
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
        window.setTimeout(tick, 1200);
      } catch {
        if (!cancelled) setError("Nie udało się odpytać joba");
      }
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [promptId]);

  useEffect(() => {
    if (!promptId || status === "completed" || status === "failed") return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [promptId, status]);

  async function uploadStartFile(file: File) {
    setError(null);
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
        return;
      }
      setStartImage(data.startImage as string);
    } catch {
      setError("Błąd sieci przy uploadzie");
      setStartImage("");
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

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setErrorDetail(null);
    setOutputs([]);
    setJobProgress(null);
    setNodesTotalHint(null);
    setStatus("queued");
    setPromptId(null);
    setStartedAtMs(Date.now());

    if (kind === "video" && !startImage.trim()) {
      setError("Dodaj obraz startowy (upload powyżej) albo wpisz nazwę pliku w Comfy input.");
      setStatus(null);
      setStartedAtMs(null);
      return;
    }

    startTransition(async () => {
      try {
        const body: Record<string, unknown> = {
          kind,
          prompt,
          negativePrompt,
          model,
          width,
          height,
          seed,
          batch: kind === "image" ? batch : 1,
        };
        if (kind === "video") {
          body.durationSec = durationSec;
          body.fps = fps;
          body.startImage = startImage.trim();
        }
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!data.ok) {
          const detail = data.errorDetail as ErrorDetail | undefined;
          setErrorDetail(detail ?? null);
          setError(data.error ?? detail?.message ?? "Generacja nieudana");
          setStatus(null);
          setStartedAtMs(null);
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
          return values.map((value) => ({
            value,
            label: value === FLUX_MODEL_ID ? "Flux.2 Dev (fp8)" : value,
            engine: isFluxModel(value) ? ("flux" as const) : ("sdxl" as const),
          }));
        })();

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <form onSubmit={onSubmit} className="studio-fade-in space-y-5">
        {kind === "video" ? (
          <div className="space-y-3">
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
                onChange={(e) => setStartImage(e.target.value)}
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

        {kind === "image" && !fluxSelected ? (
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-[0.16em] text-stone-500">
              Negatyw
            </label>
            <textarea
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              rows={2}
              className="w-full resize-y rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-stone-100 outline-none focus:border-teal-400/40 focus:ring-2 focus:ring-teal-400/20"
            />
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
              max={kind === "video" ? 576 : 2048}
              step={64}
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
              className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Wysokość">
            <input
              type="number"
              min={256}
              max={kind === "video" ? 576 : 2048}
              step={64}
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
              <Field label={`Czas (s, max ${VIDEO_UI_LIMITS.maxDurationSec})`}>
                <input
                  type="number"
                  min={1}
                  max={VIDEO_UI_LIMITS.maxDurationSec}
                  step={0.5}
                  value={durationSec}
                  onChange={(e) => setDurationSec(Number(e.target.value))}
                  className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm"
                />
              </Field>
              <Field label={`FPS (max ${VIDEO_UI_LIMITS.maxFps})`}>
                <input
                  type="number"
                  min={1}
                  max={VIDEO_UI_LIMITS.maxFps}
                  value={fps}
                  onChange={(e) => setFps(Number(e.target.value))}
                  className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm"
                />
              </Field>
            </>
          )}
        </div>

        {kind === "video" ? (
          <div className="space-y-1.5 text-sm">
            <p className="text-stone-400">
              Klatki ≈ <span className="font-mono text-stone-200">{videoFrames}</span>{" "}
              ({durationSec}s × {fps} FPS)
              {videoLimitsNote ? (
                <span className="text-stone-500"> · {videoLimitsNote}</span>
              ) : null}
            </p>
            <p className="text-stone-500">
              Start frame musi być w Comfy <code className="text-stone-400">input</code>{" "}
              — upload albo „Z galerii” (sama nazwa z output często powoduje błąd
              walidacji LoadImage).
            </p>
            {videoRisky ? (
              <p className="text-amber-200/85">
                Uwaga VRAM (~16 GB): powyżej ~{VIDEO_UI_LIMITS.comfortFrames} klatek /
                ~{VIDEO_UI_LIMITS.comfortDurationSec}–8 s SVD XT często kończy się OOM
                albo bardzo długą generacją. Schema Comfy pozwala więcej (do{" "}
                {VIDEO_UI_LIMITS.schemaMaxFrames}) — koszty rosną z liczbą klatek.
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

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending || uploadBusy}
            className="studio-cta rounded-lg bg-teal-400 px-5 py-2.5 text-sm font-semibold text-[#04201a] transition hover:bg-teal-300 disabled:opacity-60"
          >
            {pending ? "Kolejkuję…" : kind === "video" ? "Generuj wideo" : "Generuj obraz"}
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
              progress={jobProgress}
              nodesTotalHint={nodesTotalHint}
              startedAtMs={startedAtMs}
              nowMs={nowMs}
            />
          ) : (
            <p className="text-sm text-stone-500">
              Wynik pojawi się tutaj po zakończeniu joba w ComfyUI.
            </p>
          )}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {outputs.map((o) => {
              const src = `/api/comfy-view?filename=${encodeURIComponent(o.filename)}&subfolder=${encodeURIComponent(o.subfolder)}&type=${encodeURIComponent(o.type)}`;
              const isVideo = /\.(mp4|webm|mov)$/i.test(o.filename);
              return (
                <div key={`${o.subfolder}/${o.filename}`} className="overflow-hidden rounded-lg">
                  {isVideo ? (
                    <video src={src} controls className="w-full bg-black/40" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={src} alt={o.filename} className="w-full object-cover" />
                  )}
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
  progress,
  nodesTotalHint,
  startedAtMs,
  nowMs,
}: {
  status: string | null;
  promptId: string | null;
  progress: JobProgress | null;
  nodesTotalHint: number | null;
  startedAtMs: number | null;
  nowMs: number;
}) {
  const nodesTotal = progress?.nodesTotal ?? nodesTotalHint;
  const nodesDone = progress?.nodesDone;
  const start =
    progress?.executionStartMs && progress.executionStartMs > 1e11
      ? progress.executionStartMs
      : startedAtMs;
  const elapsed = start ? nowMs - start : null;

  let percent = progress?.percent;
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

  return (
    <div className="mb-3 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-stone-400">
          Status:{" "}
          <span className="text-teal-200">
            {progress?.phase || status || "…"}
          </span>
          {status && progress?.phase && status !== progress.phase ? (
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
