import Link from "next/link";
import { getStudioPublicConfig } from "@/lib/studio/config";
import { StudioBackdrop } from "./studio-backdrop";
import { StudioNav } from "./studio-nav";
import { studioDisplay, studioSans } from "./studio-fonts";

export function StudioChrome({ children }: { children: React.ReactNode }) {
  const config = getStudioPublicConfig();
  const footerNote = config.comfyRemote
    ? "Panel steruje zdalnym ComfyUI przez COMFYUI_URL (tunel)."
    : "Panel steruje lokalnym ComfyUI (COMFYUI_URL).";

  return (
    <div
      className={`${studioDisplay.variable} ${studioSans.variable} studio-shell relative flex min-h-full flex-col text-stone-100`}
    >
      <StudioBackdrop />
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#071210]/80 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <Link href="/" className="group flex items-baseline gap-3">
            <span
              className="text-2xl font-semibold tracking-tight text-teal-100 sm:text-3xl"
              style={{ fontFamily: "var(--font-studio-display), system-ui" }}
            >
              AIGen
            </span>
            <span className="text-xs font-medium uppercase tracking-[0.2em] text-stone-500 transition group-hover:text-amber-200/80">
              ComfyUI
            </span>
          </Link>
          <StudioNav />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        {children}
      </main>
      <footer className="mx-auto w-full max-w-6xl px-4 pb-10 sm:px-6">
        <p className="text-xs text-stone-500">{footerNote}</p>
      </footer>
    </div>
  );
}
