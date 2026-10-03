import Link from "next/link";
import { site } from "@/config/site";
import { GitHubMark } from "@/components/GitHubMark";

/**
 * The single repository CTA used by the landing page, the shared header, the
 * mobile menu and the footer. The URL comes from the site configuration module so
 * there is exactly one place to change.
 */
export function RepoLink({
  variant = "outline",
  className = "",
}: {
  variant?: "solid" | "outline" | "footer";
  className?: string;
}) {
  const shared =
    "inline-flex items-center gap-2 font-display text-sm font-bold tracking-tight transition-colors";
  const styles = {
    solid: "bg-rescue text-paper px-4 py-2.5 hover:bg-abyss-deep",
    outline: "border-2 border-ink text-ink px-4 py-2.5 hover:bg-ink hover:text-paper",
    footer: "text-paper/85 hover:text-paper underline underline-offset-4 decoration-1",
  }[variant];

  return (
    <a
      href={site.repository}
      target="_blank"
      rel="noopener noreferrer"
      className={`${shared} ${styles} ${className}`}
      aria-label={`${site.name} source code on GitHub — ${site.repository}`}
    >
      <GitHubMark className="text-[1.05em]" />
      <span>{variant === "solid" ? "Star on GitHub" : "View source"}</span>
    </a>
  );
}

export function RepoLinkFooter() {
  return (
    <a
      href={site.repository}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 font-mono text-xs text-paper/85 underline underline-offset-4 hover:text-paper"
      aria-label={`${site.name} source code on GitHub — ${site.repository}`}
    >
      <GitHubMark className="text-sm" />
      <span>{site.repository}</span>
    </a>
  );
}

export function Wordmark() {
  return (
    <Link href="/" className="group inline-flex items-baseline gap-2">
      <span className="display text-2xl text-ink">{site.name}</span>
      <span className="label hidden sm:inline">read the water</span>
    </Link>
  );
}