import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, ShieldAlert } from "lucide-react";
import type { Band as BandType, EngineResult, FactorResult, SourceMeta, TideSeries } from "@/lib/types";

export function Band({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`band py-10 ${className}`}>
      {children}
    </section>
  );
}

export function SectionHead({
  eyebrow,
  title,
  lead,
  right,
}: {
  eyebrow: string;
  title: string;
  lead?: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        <p className="label">{eyebrow}</p>
        <h2 className="display mt-2 text-3xl sm:text-4xl">{title}</h2>
        {lead ? <p className="mt-3 text-sm leading-relaxed text-ink-soft">{lead}</p> : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

export const BAND_LABEL: Record<BandType, string> = {
  "get-in": "Get in the water",
  "worth-the-drive": "Worth the drive",
  marginal: "Marginal",
  "stay-home": "Stay home",
  flat: "Nothing to surf",
};

export const BAND_STYLE: Record<BandType, string> = {
  "get-in": "bg-lagoon-deep text-paper",
  "worth-the-drive": "bg-lagoon-wash text-lagoon-deep border border-lagoon-deep",
  marginal: "bg-glass-deep text-ink border border-rule",
  "stay-home": "bg-ink-soft text-paper",
  flat: "bg-rescue text-paper",
};

export function VerdictBadge({ band, score }: { band: BandType; score: number }) {
  return (
    <span className={`inline-flex items-center gap-2 px-3 py-1.5 font-mono text-xs uppercase tracking-[0.12em] ${BAND_STYLE[band]}`}>
      {BAND_LABEL[band]}
      <span className="opacity-80">{(score * 100).toFixed(0)}%</span>
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="border-l-2 border-rule pl-3">
      <p className="label">{label}</p>
      <p className="data mt-1 text-lg font-bold text-ink">{value}</p>
      {hint ? <p className="mt-0.5 text-[0.6875rem] leading-snug text-ink-faint">{hint}</p> : null}
    </div>
  );
}

export function FactorBars({
  factors,
  compact = false,
}: {
  factors: FactorResult[];
  compact?: boolean;
}) {
  return (
    <ul className="space-y-2">
      {factors.map((factor) => {
        const pct = Math.round(factor.contribution * 1000) / 10;
        return (
          <li key={factor.key}>
            <div className="flex items-baseline justify-between gap-3">
              <span className={`font-mono text-xs uppercase tracking-[0.1em] ${factor.available ? "text-ink" : "text-ink-faint line-through"}`}>
                {factor.label}
              </span>
              <span className="data text-xs text-ink-soft">
                {factor.available ? `${factor.rawLabel} · ${pct.toFixed(1)}%` : factor.rawLabel}
              </span>
            </div>
            <div className="mt-1 h-2 w-full bg-glass-deep" role="presentation">
              <div
                className={`h-2 ${factor.available ? "bg-lagoon-deep" : "bg-rule"}`}
                style={{ width: `${Math.max(factor.available ? 1.5 : 0, Math.min(100, pct * 2.6))}%` }}
              />
            </div>
            {!compact ? (
              <p className="mt-1 text-[0.6875rem] leading-snug text-ink-faint">
                weight {factor.effectiveWeight.toFixed(3)}
                {factor.available ? "" : " — dropped, not guessed"}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn" | "block" | "good";
  children: ReactNode;
}) {
  const map = {
    info: { cls: "border-lagoon bg-lagoon-wash text-abyss-deep", Icon: Info },
    warn: { cls: "border-rescue bg-rescue/10 text-abyss-deep", Icon: AlertTriangle },
    block: { cls: "border-alert bg-alert/10 text-alert", Icon: ShieldAlert },
    good: { cls: "border-lagoon-deep bg-lagoon-wash text-lagoon-deep", Icon: CheckCircle2 },
  }[tone];
  const Icon = map.Icon;
  return (
    <div className={`flex items-start gap-3 border-l-4 px-4 py-3 text-sm ${map.cls}`}>
      <Icon size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border border-dashed border-rule bg-paper/60 px-6 py-10 text-center">
      <p className="font-display text-lg font-bold text-ink">{title}</p>
      <div className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-soft">{children}</div>
    </div>
  );
}

export function SealChip({ seal, label = "seal" }: { seal: string | null | undefined; label?: string }) {
  if (!seal) return <span className="label">no seal</span>;
  return (
    <span className="inline-flex items-center gap-1.5 border border-rule bg-paper px-2 py-1 font-mono text-[0.6875rem] text-ink-soft">
      <span className="text-ink-faint">{label}</span>
      <span className="text-ink" title={seal}>
        {seal.slice(0, 16)}…
      </span>
    </span>
  );
}

export function SourceList({ sources }: { sources: SourceMeta[] }) {
  if (sources.length === 0) {
    return <p className="text-sm text-ink-soft">No sources were recorded for this snapshot.</p>;
  }
  return (
    <ul className="space-y-2">
      {sources.map((source) => (
        <li key={source.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
          <span
            className={`font-mono uppercase tracking-[0.1em] ${
              source.status === "live" ? "text-lagoon-deep" : "text-rescue"
            }`}
          >
            {source.status}
          </span>
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold text-ink underline underline-offset-4 hover:text-rescue"
          >
            {source.name}
          </a>
          <span className="text-ink-faint">{source.license}</span>
          <span className="data text-ink-faint">fetched {new Date(source.fetchedAt).toISOString().slice(0, 16).replace("T", " ")} UTC</span>
          {source.stale && source.note ? <span className="w-full text-ink-soft">{source.note}</span> : null}
          {!source.stale && source.note ? <span className="w-full text-ink-faint">{source.note}</span> : null}
        </li>
      ))}
    </ul>
  );
}

export function TideFacts({ tide }: { tide: TideSeries | null }) {
  if (!tide || tide.points.length === 0) {
    return <p className="text-sm text-ink-soft">No tide station in range, so no tide value is shown anywhere in this app.</p>;
  }
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div>
        <dt className="label">Station</dt>
        <dd className="mt-1 text-sm text-ink">{tide.stationName ?? "—"}</dd>
      </div>
      <div>
        <dt className="label">Datum</dt>
        <dd className="data mt-1 text-sm text-ink">{tide.datum}</dd>
      </div>
      <div>
        <dt className="label">Range</dt>
        <dd className="data mt-1 text-sm text-ink">{tide.rangeM.toFixed(2)} m</dd>
      </div>
      <div>
        <dt className="label">Mean</dt>
        <dd className="data mt-1 text-sm text-ink">{tide.meanM.toFixed(2)} m</dd>
      </div>
    </dl>
  );
}

export function EngineSummary({ engine }: { engine: EngineResult }) {
  return (
    <div className="space-y-3">
      <VerdictBadge band={engine.band} score={engine.score} />
      <p className="text-sm leading-relaxed text-ink">{engine.recommendation}</p>
      {engine.gates.length > 0 ? (
        <ul className="space-y-1.5">
          {engine.gates.map((gate) => (
            <li key={gate.code} className="flex items-start gap-2 text-xs text-ink-soft">
              <span
                className={`mt-0.5 shrink-0 px-1.5 py-0.5 font-mono uppercase tracking-[0.1em] ${
                  gate.severity === "block"
                    ? "bg-alert text-paper"
                    : gate.severity === "warn"
                      ? "bg-rescue text-paper"
                      : "bg-glass-deep text-ink"
                }`}
              >
                {gate.severity}
              </span>
              {gate.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function Crumbs({ items }: { items: Array<{ href?: string; label: string }> }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="flex flex-wrap items-center gap-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-ink-faint">
        {items.map((item, index) => (
          <li key={item.label} className="flex items-center gap-1.5">
            {index > 0 ? <span aria-hidden="true">/</span> : null}
            {item.href ? (
              <Link href={item.href} className="hover:text-ink hover:underline underline-offset-4">
                {item.label}
              </Link>
            ) : (
              <span className="text-ink">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}