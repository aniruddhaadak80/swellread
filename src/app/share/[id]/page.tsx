import { notFound } from "next/navigation";
import { buildBrief } from "@/lib/services/sessions";
import { currentOwnerId } from "@/lib/session/owner";
import { formatLocalHour, formatLocalStamp } from "@/lib/live/conditions";
import { site } from "@/config/site";
import { RepoLink } from "@/components/RepoLink";
import { Band, Notice, SourceList } from "@/components/ui";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return {
    title: `Brief ${id.slice(0, 8)}`,
    description: "A shareable Swellread surf brief: the window worth driving for, the factor table, the frozen conditions and the integrity seal.",
  };
}

/**
 * The stable share route.
 *
 * Anyone with the link can read this page, which is the point of a handover. It
 * deliberately contains no owner id, no session note and no embedding, only the
 * conditions and the verdict that were frozen when the session was written.
 */
export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ownerId = await currentOwnerId();

  let brief;
  try {
    brief = await buildBrief(ownerId, id);
  } catch {
    notFound();
  }

  return (
    <>
      <div className="py-8">
        <p className="label">Swellread brief · share route</p>
        <h1 className="display mt-2 text-4xl">
          {brief.session.breakName}, {brief.session.breakRegion}
        </h1>
        <p className="mt-2 text-sm text-ink-soft">
          {brief.session.breakCountry} · {brief.session.breakType.replace("_", " ")} ·{" "}
          {brief.session.coordinates.lat.toFixed(3)}, {brief.session.coordinates.lon.toFixed(3)} · all times{" "}
          {brief.session.timezone}
        </p>
        <p className="mt-1 text-sm text-ink-soft">
          Planned for {formatLocalStamp(brief.session.plannedFor, brief.session.timezone)} local · brief generated{" "}
          {brief.generatedAt.slice(0, 16).replace("T", " ")} UTC
        </p>
      </div>

      <Band>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <p className="label">The call</p>
            <p className="display mt-2 text-5xl">{(brief.engine.score * 100).toFixed(0)}</p>
            <p className="mt-1 font-display text-lg font-bold">{brief.engine.band.replace(/-/g, " ")}</p>
            <p className="mt-3 text-sm leading-relaxed text-ink">{brief.engine.recommendation}</p>

            <p className="label mt-6">Window worth driving for</p>
            {brief.window.goodHours.length === 0 ? (
              <p className="mt-1 text-sm text-ink-soft">
                No hour cleared 50%. That is a real answer: the water was not worth the trip.
              </p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-2">
                {brief.window.goodHours.map((at) => (
                  <li key={at} className="border-2 border-lagoon-deep bg-lagoon-wash px-3 py-1.5 font-mono text-sm font-bold text-lagoon-deep">
                    {formatLocalHour(at, brief.session.timezone)}
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div>
                <p className="label">Break height</p>
                <p className="data mt-0.5 text-lg font-bold">
                  {brief.engine.derived.breakHeightM === null ? "—" : `${brief.engine.derived.breakHeightM.toFixed(2)} m`}
                </p>
              </div>
              <div>
                <p className="label">Peel speed</p>
                <p className="data mt-0.5 text-lg font-bold">
                  {brief.engine.derived.peelSpeedKmh === null ? "—" : `${brief.engine.derived.peelSpeedKmh.toFixed(1)} km/h`}
                </p>
              </div>
              <div>
                <p className="label">Wave power</p>
                <p className="data mt-0.5 text-lg font-bold">
                  {brief.engine.derived.powerKwM === null ? "—" : `${brief.engine.derived.powerKwM.toFixed(1)} kW/m`}
                </p>
              </div>
            </div>
          </div>

          <div>
            <p className="label">How it decided</p>
            <div className="scroll-thin mt-2 overflow-x-auto">
              <table className="w-full min-w-[420px] border-collapse text-xs">
                <thead>
                  <tr className="border-b border-ink text-left">
                    <th className="label py-2 pr-3">Factor</th>
                    <th className="label py-2 pr-3">Value</th>
                    <th className="label py-2">Contribution</th>
                  </tr>
                </thead>
                <tbody>
                  {brief.engine.factors.map((factor) => (
                    <tr key={factor.key} className="border-b border-rule align-top">
                      <td className="py-2 pr-3 font-mono text-ink">
                        {factor.label}
                        {!factor.available ? " (not scored)" : ""}
                      </td>
                      <td className="py-2 pr-3 text-ink-soft">{factor.rawLabel}</td>
                      <td className="data py-2 text-ink">{(factor.contribution * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="label mt-6">Integrity</p>
            <p className="mt-1 text-sm text-ink-soft">
              {brief.chain.length} sealed event{brief.chain.length === 1 ? "" : "s"} ·{" "}
              {brief.chain.ok ? "chain replays clean" : "chain broken"}
            </p>
            <p className="mt-2 break-all font-mono text-[0.6875rem] text-ink-faint">{brief.chain.headSeal}</p>
          </div>
        </div>
      </Band>

      <Band>
        <p className="label">Conditions, exactly as they were read</p>
        <div className="scroll-thin mt-2 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-ink text-left">
                <th className="label py-2 pr-3">Hour</th>
                <th className="label py-2 pr-3">Swell</th>
                <th className="label py-2 pr-3">Tp</th>
                <th className="label py-2 pr-3">From</th>
                <th className="label py-2 pr-3">Wind</th>
                <th className="label py-2">Tide</th>
              </tr>
            </thead>
            <tbody>
              {brief.conditions.map((hour) => (
                <tr key={hour.at} className="border-b border-rule">
                  <td className="data py-1.5 pr-3 text-ink">{formatLocalHour(hour.at, brief.session.timezone)}</td>
                  <td className="data py-1.5 pr-3 text-ink-soft">{hour.swellHeightM === null ? "—" : `${hour.swellHeightM.toFixed(2)} m`}</td>
                  <td className="data py-1.5 pr-3 text-ink-soft">{hour.swellPeriodS === null ? "—" : `${hour.swellPeriodS.toFixed(0)} s`}</td>
                  <td className="data py-1.5 pr-3 text-ink-soft">{hour.swellDirDeg === null ? "—" : `${Math.round(hour.swellDirDeg)}°`}</td>
                  <td className="data py-1.5 pr-3 text-ink-soft">{hour.windSpeedMs === null ? "—" : `${hour.windSpeedMs.toFixed(1)} m/s`}</td>
                  <td className="data py-1.5 text-ink-soft">{hour.tideM === null ? "no station" : `${hour.tideM.toFixed(2)} m`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5">
          <SourceList
            sources={brief.sourceAttribution.map((source) => ({
              ...source,
              id: "bundled-sample" as const,
              stale: source.status === "fallback",
            }))}
          />
        </div>
      </Band>

      <Band>
        <Notice tone="warn">
          <p className="font-bold">Read this before you go.</p>
          <p className="mt-1">{brief.disclaimer}</p>
        </Notice>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <RepoLink variant="solid" />
          <span className="font-mono text-xs text-ink-faint">
            {site.name} · {site.repository}
          </span>
        </div>
      </Band>
    </>
  );
}