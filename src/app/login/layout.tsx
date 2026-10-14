import { StudioBackdrop } from "@/components/studio/studio-backdrop";
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
      {children}
    </div>
  );
}
