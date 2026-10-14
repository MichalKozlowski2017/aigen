import { IBM_Plex_Sans, Syne } from "next/font/google";

export const studioDisplay = Syne({
  subsets: ["latin", "latin-ext"],
  variable: "--font-studio-display",
  weight: ["500", "600", "700", "800"],
});

export const studioSans = IBM_Plex_Sans({
  subsets: ["latin", "latin-ext"],
  variable: "--font-studio-sans",
  weight: ["400", "500", "600"],
});
