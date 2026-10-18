import { StudioBackdrop } from "@/components/studio/studio-backdrop";
import { ThemeToggle } from "@/components/studio/theme-toggle";
import { studioDisplay, studioSans } from "@/components/studio/studio-fonts";

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className={`${studioDisplay.variable} ${studioSans.variable} studio-shell relative min-h-full`}
    >
      <StudioBackdrop />
      <div className="absolute right-4 top-4 z-40 sm:right-6 sm:top-6">
        <ThemeToggle />
      </div>
      {children}
    </div>
  );
}
