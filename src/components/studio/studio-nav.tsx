"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS: { href: string; label: string; exact?: boolean }[] = [
  { href: "/", label: "Pulpit", exact: true },
  { href: "/generate", label: "Generuj" },
  { href: "/video", label: "Wideo" },
  { href: "/gallery", label: "Galeria" },
  { href: "/models", label: "Modele" },
  { href: "/settings", label: "Ustawienia" },
];

export function StudioNav() {
  const pathname = usePathname();

  return (
    <nav
      className="flex flex-wrap items-center gap-1 sm:gap-1.5"
      aria-label="Nawigacja AIGen"
    >
      {LINKS.map((link) => {
        const active = link.exact
          ? pathname === link.href
          : pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={[
              "inline-flex min-h-11 items-center rounded-md px-3.5 py-2 text-sm font-semibold transition-colors duration-200",
              active
                ? "bg-teal-400/15 text-teal-100 ring-1 ring-studio-border-strong"
                : "text-stone-400 hover:bg-studio-surface-hover hover:text-stone-100",
            ].join(" ")}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
