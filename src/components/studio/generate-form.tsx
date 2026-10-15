"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { DEFAULT_SDXL_NEGATIVE } from "@/lib/studio/defaults";

type JobOutput = {
  filename: string;
  subfolder: string;
  type: string;
};

type Props = {
  defaultModel: string;
  checkpoints: string[];
  kind?: "image" | "video";
  videoLimitsNote?: string;
};

export function GenerateForm({
  defaultModel,
  checkpoints,
  kind = "image",
  videoLimitsNote,
}: Props) {
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState(
    kind === "image" ? DEFAULT_SDXL_NEGATIVE : ""
  );
  const [model, setModel] = useState(defaultModel);
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
  const [promptId, setPromptId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<JobOutput[]>([]);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

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
        setStatus(data.job.status);
        setOutputs(data.job.outputs ?? []);
        if (data.job.status === "completed" || data.job.status === "failed") {
          return;
        }
        window.setTimeout(tick, 1500);
      } catch {
        if (!cancelled) setError("Nie udało się odpytać joba");
      }
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [promptId]);

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

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOutputs([]);
    setStatus("queued");
    setPromptId(null);

    if (kind === "video" && !startImage.trim()) {
      setError("Dodaj obraz startowy (upload powyżej) albo wpisz nazwę pliku w Comfy input.");
      setStatus(null);
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
          setError(data.error ?? "Generacja nieudana");
          setStatus(null);
          return;
        }
        setPromptId(data.promptId);
      } catch {
        setError("Błąd sieci");
        setStatus(null);
      }
    });
  }

  const modelOptions =
    checkpoints.length > 0
      ? Array.from(new Set([defaultModel, ...checkpoints]))
      : [defaultModel];

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
                ? "Opis ruchu / klimatu (SVD używa głównie obrazu startowego)…"
                : "Opisz obraz…"
            }
          />
        </div>

        {kind === "image" ? (
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
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-[#0b1614] px-3 py-2 text-sm"
            >
              {modelOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
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
              <Field label="Czas (s, max 4)">
                <input
                  type="number"
                  min={1}
                  max={4}
                  step={0.5}
                  value={durationSec}
                  onChange={(e) => setDurationSec(Number(e.target.value))}
                  className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm"
                />
              </Field>
              <Field label="FPS (max 12)">
                <input
                  type="number"
                  min={6}
                  max={12}
                  value={fps}
                  onChange={(e) => setFps(Number(e.target.value))}
                  className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm"
                />
              </Field>
            </>
          )}
        </div>

        {videoLimitsNote ? (
          <p className="text-sm text-amber-200/70">{videoLimitsNote}</p>
        ) : null}

        {error ? (
          <p className="text-sm text-rose-300" role="alert">
            {error}
          </p>
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
          {status ? (
            <p className="mb-3 text-sm text-stone-400">
              Status: <span className="text-teal-200">{status}</span>
              {promptId ? (
                <span className="ml-2 font-mono text-xs text-stone-600">
                  {promptId.slice(0, 8)}…
                </span>
              ) : null}
            </p>
          ) : (
            <p className="text-sm text-stone-500">
              Wynik pojawi się tutaj po zakończeniu joba w ComfyUI.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
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
