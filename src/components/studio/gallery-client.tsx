"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GalleryItem } from "@/lib/studio/types";

function LazyVideoThumb({ item }: { item: GalleryItem }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [active, setActive] = useState(
    () => typeof IntersectionObserver === "undefined"
  );

  useEffect(() => {
    if (active) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setActive(true);
            io.disconnect();
            break;
          }
        }
      },
      { rootMargin: "120px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [active]);

  return (
    <video
      ref={ref}
      key={item.url}
      src={active ? item.url : undefined}
      controls={active}
      playsInline
      preload="none"
      className="aspect-video w-full bg-studio-media"
    >
      {active ? <a href={item.url}>Otwórz wideo</a> : null}
    </video>
  );
}

export function GalleryClient({
  initialItems,
  configured,
  message,
  source = "none",
  initialTotal,
}: {
  initialItems: GalleryItem[];
  configured: boolean;
  message: string | null;
  source?: "local" | "comfy" | "none";
  initialTotal?: number;
}) {
  const [kind, setKind] = useState<"all" | "image" | "video">("all");
  const [allItems, setAllItems] = useState(initialItems);
  const [error, setError] = useState<string | null>(message);
  const [src, setSrc] = useState(source);
  const [total, setTotal] = useState(initialTotal ?? initialItems.length);
  const [downloadBusy, setDownloadBusy] = useState<string | null>(null);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  // Filtr Obrazy/Wideo — tylko lokalnie, bez refetch API.
  const items = useMemo(() => {
    if (kind === "all") return allItems;
    return allItems.filter((i) => i.kind === kind);
  }, [allItems, kind]);

  const refreshIndex = useCallback(async () => {
    setRefreshBusy(true);
    setError(null);
    setHint(null);
    try {
      const res = await fetch("/api/gallery/refresh", { method: "POST" });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "Odświeżanie indeksu nieudane");
        return;
      }
      setAllItems(data.items ?? []);
      setTotal(
        typeof data.total === "number" ? data.total : (data.items?.length ?? 0)
      );
      setError(data.error ?? null);
      setSrc(data.source ?? "none");
      setHint(
        data.hint ??
          "Indeks przeładowany. Pełny skan dysku: seed-comfy-gallery-index.py na Legionie."
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Odświeżanie indeksu nieudane"
      );
    } finally {
      setRefreshBusy(false);
    }
  }, []);

  async function downloadItem(item: GalleryItem) {
    setDownloadBusy(item.id);
    setError(null);
    try {
      const res = await fetch(item.url);
      if (!res.ok) {
        throw new Error(`Pobieranie HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = item.name || "download";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Nie udało się pobrać pliku"
      );
    } finally {
      setDownloadBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {(["all", "image", "video"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={[
                "inline-flex min-h-11 items-center rounded-md px-3.5 py-2 text-sm font-semibold transition",
                kind === k
                  ? "bg-teal-400/15 text-teal-100 ring-1 ring-studio-border-strong"
                  : "text-stone-400 hover:bg-studio-surface-hover hover:text-stone-100",
              ].join(" ")}
            >
              {k === "all" ? "Wszystko" : k === "image" ? "Obrazy" : "Wideo"}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void refreshIndex()}
            disabled={refreshBusy}
            className="inline-flex min-h-11 items-center rounded-md border border-studio-border px-3 py-2 text-sm font-medium text-stone-300 transition hover:border-teal-400/40 hover:text-teal-100 disabled:opacity-50"
            title="Ponowny odczyt aigen-gallery-index.json (bez pełnego skanu dysku)"
          >
            {refreshBusy ? "Odświeżam…" : "Odśwież indeks"}
          </button>
          {src !== "none" ? (
            <p className="text-xs text-stone-500">
              Źródło:{" "}
              {src === "comfy" ? "Comfy (indeks)" : "dysk lokalny"}
              {total > 0 ? ` · ${items.length}/${total}` : null}
            </p>
          ) : null}
        </div>
      </div>

      {!configured || error ? (
        <p className="text-sm text-amber-200/80">
          {error ?? "Brak konfiguracji output."}
        </p>
      ) : null}

      {hint ? <p className="text-xs text-stone-500">{hint}</p> : null}

      {items.length === 0 && configured && !error ? (
        <p className="text-sm text-stone-500">
          Brak plików — wygeneruj obraz na zakładce Generuj (trafia do output /
          indeksu Comfy). Jeśli brakuje nowych wideo: Odśwież indeks albo seed na
          Legionie.
        </p>
      ) : null}

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const subHint =
            item.comfy?.subfolder != null && item.comfy.subfolder !== ""
              ? item.comfy.subfolder
              : null;
          return (
            <li
              key={item.id}
              className="studio-fade-in overflow-hidden rounded-xl border border-studio-border bg-studio-surface"
            >
              {item.kind === "video" ? (
                <LazyVideoThumb item={item} />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.url}
                  alt={item.name}
                  loading="lazy"
                  decoding="async"
                  className="aspect-square w-full object-cover"
                />
              )}
              <div className="space-y-2 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm text-stone-200">{item.name}</p>
                  <p className="text-xs text-stone-500">
                    {subHint ? (
                      <span className="text-stone-400">{subHint}/ · </span>
                    ) : null}
                    {item.sizeBytes > 0
                      ? `${(item.sizeBytes / 1024).toFixed(0)} KB · `
                      : null}
                    {new Date(item.mtimeMs).toLocaleString("pl-PL")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void downloadItem(item)}
                    disabled={downloadBusy === item.id}
                    className="inline-flex min-h-11 items-center rounded-md border border-studio-border bg-studio-surface-hover px-3 py-2 text-sm font-medium text-stone-200 transition hover:border-teal-400/40 hover:text-teal-100 disabled:opacity-50"
                  >
                    {downloadBusy === item.id ? "Pobieram…" : "Pobierz"}
                  </button>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center rounded-md border border-studio-border px-3 py-2 text-sm font-medium text-stone-400 transition hover:border-studio-border-strong hover:text-stone-200"
                  >
                    Otwórz
                  </a>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
