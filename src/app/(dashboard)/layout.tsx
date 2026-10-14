import type { Metadata } from "next";
import { StudioChrome } from "@/components/studio/studio-chrome";

export const metadata: Metadata = {
  title: "Pulpit",
  description: "Lokalny panel sterowania ComfyUI — AIGen",
  robots: { index: false, follow: false },
};

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return <StudioChrome>{children}</StudioChrome>;
}
