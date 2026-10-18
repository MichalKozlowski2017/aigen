import type { Metadata } from "next";
import { ThemeScript } from "@/components/studio/theme-script";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "AIGen",
    template: "%s · AIGen",
  },
  description: "Lokalny panel sterowania ComfyUI na RTX 5080",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pl"
      className="h-full antialiased"
      data-theme="light"
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <ThemeScript />
        {children}
      </body>
    </html>
  );
}
