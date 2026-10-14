import type { ComfyHealth } from "@/lib/studio/types";

export function HealthPanel({ health }: { health: ComfyHealth }) {
  return (
    <div className="studio-fade-in flex flex-wrap items-end justify-between gap-6">
      <div className="max-w-xl space-y-3">
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-teal-300/70">
          Status silnika
        </p>
        <h1
          className="text-4xl font-semibold tracking-tight text-stone-50 sm:text-5xl"
          style={{ fontFamily: "var(--font-studio-display), system-ui" }}
        >
          {health.online ? "ComfyUI online" : "ComfyUI offline"}
        </h1>
        <p className="text-base leading-relaxed text-stone-400">
          {health.online
            ? "Silnik odpowiada — możesz generować obrazy i wideo."
            : "Uruchom ComfyUI na laptopie (RTX) i ustaw COMFYUI_URL. Panel działa offline-gracefully."}
        </p>
      </div>
      <div
        className={[
          "studio-pulse-dot flex items-center gap-3 rounded-full px-4 py-2 text-sm font-medium",
          health.online
            ? "bg-teal-400/10 text-teal-200 ring-1 ring-teal-400/30"
            : "bg-amber-500/10 text-amber-100 ring-1 ring-amber-500/25",
        ].join(" ")}
      >
        <span
          className={[
            "h-2.5 w-2.5 rounded-full",
            health.online ? "bg-teal-300" : "bg-amber-400",
          ].join(" ")}
          aria-hidden
        />
        {health.online
          ? `${health.latencyMs ?? "—"} ms · ${health.url}`
          : health.error ?? "brak połączenia"}
      </div>
    </div>
  );
}
