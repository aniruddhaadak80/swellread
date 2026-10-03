import Link from "next/link";
import { site } from "@/config/site";
import { RepoLinkFooter } from "@/components/RepoLink";

const FOOTER_LINKS: Array<{ href: string; label: string }> = [
  { href: "/breaks", label: "Breaks" },
  { href: "/sessions", label: "Sessions" },
  { href: "/lab", label: "Wave lab" },
  { href: "/agent", label: "Agent console" },
  { href: "/export", label: "Export a brief" },
  { href: "/method", label: "Method" },
  { href: "/verify", label: "Integrity replay" },
  { href: "/api/health", label: "Health" },
  { href: "/api/mcp", label: "MCP discovery" },
];

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t-2 border-ink bg-abyss-deep text-paper">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <p className="display text-2xl">{site.name}</p>
          <p className="mt-2 max-w-sm text-sm text-paper/80">{site.tagline}</p>
          <p className="mt-4 max-w-sm text-xs leading-relaxed text-paper/60">
            Surf forecasts describe the surface of the ocean, not what is happening underneath it. Swellread is a
            planning aid, not a safety guarantee.
          </p>
        </div>

        <nav aria-label="Footer">
          <p className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-paper/50">Product</p>
          <ul className="mt-3 space-y-1.5">
            {FOOTER_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="text-sm text-paper/85 hover:text-paper hover:underline underline-offset-4">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div>
          <p className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-paper/50">Source</p>
          <p className="mt-3 text-sm text-paper/85">The whole app is open source and MIT licensed.</p>
          <p className="mt-3">
            <RepoLinkFooter />
          </p>
          <p className="mt-4 font-mono text-[0.6875rem] text-paper/50">
            Engine {site.engineVersion}
          </p>
          <p className="mt-1 font-mono text-[0.6875rem] text-paper/50">
            Data: NOAA CO-OPS · Open-Meteo
          </p>
        </div>
      </div>

      <div className="border-t border-paper/15">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-4 text-xs text-paper/55 sm:flex-row sm:items-center sm:justify-between">
          <p>
            Built by {site.author}. Wave data from NOAA CO-OPS and Open-Meteo; coordinates describe real
            coastlines.
          </p>
          <p className="font-mono">MIT licensed</p>
        </div>
      </div>
    </footer>
  );
}