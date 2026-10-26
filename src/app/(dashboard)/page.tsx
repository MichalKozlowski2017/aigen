import Link from "next/link";
import { EngineSwitch } from "@/components/studio/engine-switch";
import { HealthPanel } from "@/components/studio/health-panel";
import { checkComfyHealth } from "@/lib/studio/comfy-client";
import { getStudioPublicConfigAsync } from "@/lib/studio/config";
import { getEngineSwitchView } from "@/lib/studio/engine-switch";

export const dynamic = "force-dynamic";

export default async function StudioDashboardPage() {
  const [health, config, engine] = await Promise.all([
    checkComfyHealth(),
    getStudioPublicConfigAsync(),
    getEngineSwitchView(),
  ]);

  return (
    <div className="space-y-12">
      <HealthPanel health={health} />
      <EngineSwitch initial={engine} />

      <section className="studio-fade-in-delayed grid gap-6 sm:grid-cols-3">
        <DashLink
          href="/generate"
          title="Nowy obraz"
          desc="Flux.2 Dev (fp8) — prompt, model, seed. Limit ~16 GB VRAM."
        />
        <DashLink
          href="/video"
          title="Wideo"
          desc="Wan I2V Fast 480p (+ Smooth 24 / RIFE) — limity 16 GB."
        />
        <DashLink
          href="/models"
          title="Modele"
          desc="Katalog polecanych wag i status przez Comfy API."
        />
      </section>

      <section className="space-y-2 border-t border-studio-border pt-8">
        <h2
          className="text-lg font-semibold text-stone-200"
          style={{ fontFamily: "var(--font-studio-display), system-ui" }}
        >
          Konfiguracja
        </h2>
        <ul className="space-y-1 text-sm text-stone-500">
          <li>
            ComfyUI ({config.comfyRemote ? "zdalny" : "lokalny"}):{" "}
            <code className="text-stone-300">{config.comfyUrl}</code>
          </li>
          <li>
            Modele:{" "}
            {config.modelsDirConfigured ? (
              <code className="text-stone-300">{config.modelsDir}</code>
            ) : config.comfyRemote ? (
              <span className="text-stone-400">
                zdalny Comfy — status wag przez API (
                <code className="text-stone-300">COMFYUI_URL</code>)
              </span>
            ) : (
              <span className="text-amber-200/80">
                nie ustawiono COMFYUI_MODELS_DIR
              </span>
            )}
          </li>
          <li>
            Output / galeria:{" "}
            {config.outputDirConfigured ? (
              <code className="text-stone-300">{config.outputDir}</code>
            ) : config.comfyRemote ? (
              <span className="text-stone-400">
                galeria przez API / historię Comfy (
                <code className="text-stone-300">COMFYUI_URL</code>)
              </span>
            ) : (
              <span className="text-amber-200/80">
                nie ustawiono COMFYUI_OUTPUT_DIR
              </span>
            )}
          </li>
        </ul>
        <p className="pt-2 text-sm">
          <Link href="/settings" className="text-teal-300/90 hover:underline">
            Pełne ustawienia →
          </Link>
        </p>
      </section>
    </div>
  );
}

function DashLink({
  href,
  title,
  desc,
}: {
  href: string;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="group block border-t border-teal-400/20 pt-4 transition hover:border-teal-300/50"
    >
      <p
        className="text-xl font-semibold text-stone-100 transition group-hover:text-teal-100"
        style={{ fontFamily: "var(--font-studio-display), system-ui" }}
      >
        {title}
      </p>
      <p className="mt-1 text-sm text-stone-500">{desc}</p>
    </Link>
  );
}
