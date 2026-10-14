import Link from "next/link";
import { HealthPanel } from "@/components/studio/health-panel";
import { checkComfyHealth } from "@/lib/studio/comfy-client";
import { getStudioPublicConfig } from "@/lib/studio/config";

export const dynamic = "force-dynamic";

export default async function StudioDashboardPage() {
  const [health, config] = await Promise.all([
    checkComfyHealth(),
    Promise.resolve(getStudioPublicConfig()),
  ]);

  return (
    <div className="space-y-12">
      <HealthPanel health={health} />

      <section className="studio-fade-in-delayed grid gap-6 sm:grid-cols-3">
        <DashLink
          href="/generate"
          title="Nowy obraz"
          desc="SDXL txt2img — prompt, model, seed."
        />
        <DashLink
          href="/video"
          title="Wideo"
          desc="Krótki img2vid z limitami 16 GB VRAM."
        />
        <DashLink
          href="/models"
          title="Modele"
          desc="Katalog polecanych wag i pobieranie."
        />
      </section>

      <section className="space-y-2 border-t border-white/[0.06] pt-8">
        <h2
          className="text-lg font-semibold text-stone-200"
          style={{ fontFamily: "var(--font-studio-display), system-ui" }}
        >
          Konfiguracja
        </h2>
        <ul className="space-y-1 text-sm text-stone-500">
          <li>
            ComfyUI: <code className="text-stone-300">{config.comfyUrl}</code>
          </li>
          <li>
            Modele:{" "}
            {config.modelsDirConfigured ? (
              <code className="text-stone-300">{config.modelsDir}</code>
            ) : (
              <span className="text-amber-200/80">nie ustawiono COMFYUI_MODELS_DIR</span>
            )}
          </li>
          <li>
            Output:{" "}
            {config.outputDirConfigured ? (
              <code className="text-stone-300">{config.outputDir}</code>
            ) : (
              <span className="text-amber-200/80">nie ustawiono COMFYUI_OUTPUT_DIR</span>
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
