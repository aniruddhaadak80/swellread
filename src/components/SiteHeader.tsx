"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { site } from "@/config/site";
import { RepoLink, Wordmark } from "@/components/RepoLink";

/**
 * Shared desktop and mobile navigation.
 *
 * The repository link lives here, in the mobile menu, on the landing page and in
 * the footer. All four read the same URL from the site configuration module.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-50 border-b border-rule bg-glass/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Wordmark />

        <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
          {site.nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={`px-2.5 py-1.5 font-mono text-xs uppercase tracking-[0.12em] transition-colors ${
                isActive(item.href) ? "text-rescue" : "text-ink-soft hover:text-ink"
              }`}
            >
              {item.label}
            </Link>
          ))}
          <RepoLink variant="outline" className="ml-2" />
        </nav>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="mobile-menu"
          className="inline-flex items-center gap-2 border-2 border-ink px-3 py-2 font-mono text-xs uppercase tracking-[0.12em] text-ink lg:hidden"
        >
          {open ? <X size={16} aria-hidden="true" /> : <Menu size={16} aria-hidden="true" />}
          Menu
        </button>
      </div>

      {open ? (
        <div id="mobile-menu" className="border-t border-rule bg-paper lg:hidden">
          <nav aria-label="Mobile" className="mx-auto flex max-w-6xl flex-col px-4 py-2">
            {site.nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={`border-b border-rule py-3 font-mono text-xs uppercase tracking-[0.14em] ${
                  isActive(item.href) ? "text-rescue" : "text-ink"
                }`}
              >
                {item.label}
              </Link>
            ))}
            <div className="py-4">
              <RepoLink variant="solid" />
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}