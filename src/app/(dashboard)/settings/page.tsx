import { getStudioPublicConfig } from "@/lib/studio/config";

export const dynamic = "force-dynamic";

export default function StudioSettingsPage() {
  const config = getStudioPublicConfig();

  const rows: { label: string; value: string }[] = [
    { label: "COMFYUI_URL", value: config.comfyUrl },
    {
      label: "COMFYUI_MODELS_DIR",
      value: config.modelsDir ?? "(nie ustawiono)",
    },
    {
      label: "COMFYUI_OUTPUT_DIR",
      value: config.outputDir ?? "(nie ustawiono)",
    },
    {
      label: "STUDIO_PASSWORD",
      value: config.passwordRequired ? "ustawione (ukryte)" : "wyłączone — otwarty dostęp lokalny",
    },
    { label: "Domyślny checkpoint", value: config.defaultCheckpoint },
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
          Wartości tylko do odczytu z serwera. Sekretów nie pokazujemy — zmień je w{" "}
          <code className="text-stone-300">.env.local</code>.
        </p>
      </header>

      <dl className="divide-y divide-white/[0.06] border-y border-white/[0.06]">
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
