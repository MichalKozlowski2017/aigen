import type { Metadata } from "next";
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
    <html lang="pl" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-[#071210] text-stone-100">
        {children}
      </body>
    </html>
  );
}
