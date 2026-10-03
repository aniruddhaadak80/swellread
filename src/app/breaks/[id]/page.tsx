import Link from "next/link";
import { notFound } from "next/navigation";
import { analyseBreak } from "@/lib/services/analysis";
import { getBreak } from "@/lib/live/breaks";
import { TIDE_WINDOWS } from "@/lib/swell/engine";
import { BathymetrySection } from "@/components/BathymetrySection";
import { PlanSessionButton } from "@/components/PlanSessionButton";
import { TideRibbon } from "@/components/TideRibbon";
import {
  Band,
  Crumbs,
  EngineSummary,
  FactorBars,
  Notice,
  SectionHead,
  SourceList,
  Stat,
  TideFacts,
  VerdictBadge,
} from "@/components/ui";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const surfBreak = getBreak(id);
  if (!surfBreak) return { title: "Break not found" };
  return {
    title: `${surfBreak.name}, ${surfBreak.region}`,
    description: surfBreak.blurb,
  };
}

export default async function BreakPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const query = await searchParams;
  const surfBreak = getBreak(id);
  if (!surfBreak) notFound();

  const rawHour = typeof query.hour === "string" ? Number(query.hour) : NaN;
  const hour = Number.isFinite(rawHour) ? Math.min(23, Math.max(0, Math.round(rawHour))) : 0;

  let analysis: Awaited<ReturnType<typeof analyseBreak>>;
  try {
    analysis = await analyseBreak({ breakId: id, hour });
  } catch (error) {
    return (
      <div className="py-12">
        <Notice tone="block">
          <p className="font-bold">Today&apos;s conditions for {surfBreak.name} could not be loaded.</p>
          <p className="mt-1">{error instanceof Error ? error.message : "the conditions service did not answer"}</p>
          <p className="mt-2">
            No numbers have been invented. Try{" "}
            <Link href="/breaks" className="underline underline-offset-4">
              another break
            </Link>
            .
          </p>
        </Notice>
      </div>
    );
  }

  const spec = TIDE_WINDOWS[surfBreak.breakType];
  const point = analysis.points[hour] ?? analysis.points[0];
  const good = analysis.points.filter((entry) => entry.score >= 0.5);

  return (
    <>
      <div className="py-8">
        <Crumbs items={[{ href: "/", label: "Home" }, { href: "/breaks", label: "Breaks" }, { label: surfBreak.name }]} />

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-3xl">
            <p className="label">
              {surfBreak.region}, {surfBreak.country} · {surfBreak.timezone}
            </p>
            <h1 className="display mt-2 text-4xl sm:text-5xl">{surfBreak.name}</h1>
            <p className="mt-3 text-sm leading-relaxed text-ink-soft">{surfBreak.blurb}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <PlanSessionButton
              breakId={surfBreak.id}
              plannedFor={point.at}
              hourLabel={point.localLabel}
              band={`${(analysis.engine.score * 100).toFixed(0)}%`}
            />
          </div>
        </div>

        {analysis.status !== "live" ? (
          <div className="mt-5">
            <Notice tone={analysis.status === "fallback" ? "warn" : "info"}>
              {analysis.status === "fallback" ? (
                <>
                  <p className="font-bold">Every upstream was unreachable, so this is the sealed offline sample.</p>
                  <p className="mt-1">
                    It is a fixed, dated synthetic profile, not today&apos;s water. Nothing you have created has been
                    replaced, and nothing on this page is presented as live.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-bold">Part of this page is live and part is not.</p>
                  <p className="mt-1">See the source list at the bottom for exactly which feed answered.</p>
                </>
              )}
            </Notice>
          </div>
        ) : null}
      </div>

      <Band>
        <SectionHead
          eyebrow={`${point.localLabel} local · ${analysis.snapshot.date}`}
          title={`${(analysis.engine.score * 100).toFixed(0)}% — the read for this hour`}
          right={<VerdictBadge band={analysis.engine.band} score={analysis.engine.score} />}
        />

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Stat label="Swell" value={point.swellHeightM === null ? "—" : `${point.swellHeightM.toFixed(2)} m`} />
              <Stat label="Period" value={point.swellPeriodS === null ? "—" : `${point.swellPeriodS.toFixed(0)} s`} />
              <Stat label="Swell from" value={analysis.hour.swellDirDeg === null ? "—" : `${Math.round(analysis.hour.swellDirDeg)}°`} />
              <Stat label="Wind" value={analysis.hour.windSpeedMs === null ? "—" : `${analysis.hour.windSpeedMs.toFixed(1)} m/s`} />
              <Stat label="Wind from" value={analysis.hour.windDirDeg === null ? "—" : `${Math.round(analysis.hour.windDirDeg)}°`} />
              <Stat label="Air" value={analysis.hour.airTempC === null ? "—" : `${analysis.hour.airTempC.toFixed(0)}°C`} />
            </div>

            <div className="mt-6">
              <EngineSummary engine={analysis.engine} />
            </div>

            <p className="mt-6 text-sm text-ink">
              {good.length === 0 ? (
                <>No hour today clears the &quot;worth the drive&quot; bar at {surfBreak.name}.</>
              ) : (
                <>
                  <strong className="font-bold">{good.length} hour{good.length === 1 ? "" : "s"}</strong> worth driving
                  for today: {good.map((entry) => entry.localLabel).join(", ")}.
                </>
              )}
            </p>
            <p className="mt-2 text-xs text-ink-faint">
              Tide window for a {surfBreak.breakType.replace("_", " ")}: {spec.idealMin}–{spec.idealMax} m of water over the
              take-off; below {spec.minSafe.toFixed(2)} m it {spec.label} matters and the reef is exposed.
            </p>
          </div>

          <div>
            <TideRibbon
              title={`${surfBreak.name} · 24 hours, local time`}
              caption={analysis.status === "fallback" ? "sealed offline sample" : `${analysis.status} data`}
              points={analysis.points}
              activeIndex={hour}
              currentIndex={analysis.currentIndex}
              hrefFor={(index) => `/breaks/${surfBreak.id}?hour=${index}`}
            />
            <p className="mt-3 text-xs leading-relaxed text-ink-faint">
              Dashed line is the tide above MLLW, solid line is the swell height. Column height is the engine score for
              that hour. Faded columns are gated. The hour you select is in the URL, so this page is shareable as-is.
            </p>

            <div className="mt-6 border border-rule bg-paper px-4 py-4">
              <p className="label">Tide station</p>
              <div className="mt-2">
                <TideFacts tide={analysis.tide} />
              </div>
            </div>
          </div>
        </div>
      </Band>

      <Band>
        <SectionHead
          eyebrow="Signature interaction"
          title="Drag the tide and watch the reef change its mind"
          lead="The cross-section is drawn from the break's own reef slope. Every change re-runs the shared engine on the server and returns a fresh seal — this control cannot work without the API."
        />
        <BathymetrySection
          breakId={surfBreak.id}
          breakName={surfBreak.name}
          breakType={surfBreak.breakType}
          reefSlope={surfBreak.reefSlope}
          depthAtBreakM={surfBreak.depthAtBreakM}
          hour={hour}
          initialTide={analysis.hour.tideM}
          initialEngine={analysis.engine}
        />
      </Band>

      <Band>
        <SectionHead
          eyebrow="Show your working"
          title="Every factor, its weight, and the arithmetic behind it"
          lead="Weights are renormalised over the factors that have real data behind them. A factor with no data is dropped and said so, never quietly scored at zero."
        />
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div>
            <FactorBars factors={analysis.engine.factors} />
            <p className="mt-4 font-mono text-xs text-ink-faint">
              engine seal {analysis.engine.seal}
            </p>
          </div>
          <ul className="space-y-3">
            {analysis.engine.factors.map((factor) => (
              <li key={factor.key} className="border-l-2 border-rule pl-3">
                <p className="font-mono text-xs uppercase tracking-[0.1em] text-ink">
                  {factor.label}
                  {!factor.available ? <span className="ml-2 text-rescue">not scored</span> : null}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-ink-soft">{factor.evidence}</p>
              </li>
            ))}
          </ul>
        </div>
      </Band>

      <Band>
        <SectionHead eyebrow="Provenance" title="Every number above came from one of these" />
        <SourceList sources={analysis.snapshot.sources} />
        <p className="mt-4 text-xs text-ink-faint">
          Snapshot generated {analysis.snapshot.generatedAt}. Break orientation, reef slope and take-off depth come from
          this project&apos;s catalogue and are labelled as estimates, not survey data.
        </p>
      </Band>
    </>
  );
}