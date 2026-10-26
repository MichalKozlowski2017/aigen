import { FreeModelsButton } from "@/components/studio/free-models-button";
import { getStudioPublicConfigAsync } from "@/lib/studio/config";

export const dynamic = "force-dynamic";

export default async function StudioSettingsPage() {
  const config = await getStudioPublicConfigAsync();

  const modelsDirValue = config.modelsDir
    ? config.modelsDir
    : config.comfyRemote
      ? "(nie potrzebne — status modeli przez COMFYUI_URL / API)"
      : "(nie ustawiono)";

  const outputDirValue = config.outputDir
    ? config.outputDir
    : config.comfyRemote
      ? "(nie potrzebne — galeria przez historię Comfy / API)"
      : "(nie ustawiono)";

  const rows: { label: string; value: string }[] = [
    {
      label: "COMFYUI_URL",
      value: `${config.comfyUrl} (${config.comfyRemote ? "zdalny" : "lokalny"})`,
    },
    {
      label: "COMFYUI_MODELS_DIR",
      value: modelsDirValue,
    },
    {
      label: "COMFYUI_OUTPUT_DIR",
      value: outputDirValue,
    },
    {
      label: "STUDIO_PASSWORD",
      value: config.passwordRequired
        ? "ustawione (ukryte)"
        : "wyłączone — otwarty dostęp",
    },
    {
      label: "MINIMAX_API_KEY",
      value: config.minimaxApiKeyConfigured
        ? "ustawione (ukryte) — MiniMax-H3-Lite, pay-as-you-go"
        : "brak — H3-Lite nie wystartuje",
    },
    {
      label: "Domyślny model obrazu",
      value: config.defaultImageModel,
    },
    { label: "Checkpoint SDXL (opcja)", value: config.defaultCheckpoint },
  ];

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-teal-300/70">
          ENV
        </p>
        <h1
          className="text-3xl font-semibold tracking-tight text-stone-50 sm:text-4xl"
          style={{ fontFamily: "var(--font-studio-display), system-ui" }}
        >
          Ustawienia
        </h1>
        <p className="max-w-2xl text-stone-400">
          Wartości tylko do odczytu z serwera. Primarny łącznik:{" "}
          <code className="text-stone-300">COMFYUI_URL</code>
          {config.comfyRemote
            ? " (tunel / Vercel). Ścieżki MODELS/OUTPUT są tylko dla panelu lokalnego."
            : ". Sekretów nie pokazujemy — zmień je w .env.local."}
        </p>
        {config.comfyRemote ? (
          <p className="max-w-2xl text-sm text-stone-500">
            Bez domeny: auto-publish z Legionu —{" "}
            <code className="text-stone-400">scripts/legion/publish-comfy-url.ps1</code>{" "}
            → <code className="text-stone-400">POST /api/settings/comfy-url</code>{" "}
            (sekret <code className="text-stone-400">COMFY_URL_UPDATE_SECRET</code>
            ). Po restarcie Quick Tunnel URL aktualizuje się bez ręcznych Settings.
          </p>
        ) : null}
      </header>

      <FreeModelsButton variant="panel" />

      <dl className="divide-y divide-studio-border border-y border-studio-border">
        {rows.map((row) => (
          <div
            key={row.label}
            className="grid gap-1 py-4 sm:grid-cols-[14rem_minmax(0,1fr)] sm:gap-6"
          >
            <dt className="text-sm font-medium text-stone-500">{row.label}</dt>
            <dd className="break-all font-mono text-sm text-stone-200">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
