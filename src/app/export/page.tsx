import Link from "next/link";
import { readSessions, buildBrief } from "@/lib/services/sessions";
import { currentOwnerId } from "@/lib/session/owner";
import { getBreak } from "@/lib/live/breaks";
import { formatLocalHour, formatLocalStamp } from "@/lib/live/conditions";
import { site } from "@/config/site";
import { RepoLink } from "@/components/RepoLink";
import { Band, Crumbs, EmptyState, Notice, SectionHead, SealChip, SourceList } from "@/components/ui";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Export a brief",
  description:
    "A shareable, printable surf brief: the exact window, every factor, the frozen conditions table, full data attribution and the integrity chain seal.",
};

export default async function ExportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const selected = typeof query.session === "string" ? query.session : null;
  const ownerId = await currentOwnerId();
  const page = await readSessions(ownerId, { limit: 20 });

  let brief = null;
  let briefError: string | null = null;
  if (selected) {
    try {
      brief = await buildBrief(ownerId, selected);
    } catch (error) {
      briefError = error instanceof Error ? error.message : "The brief could not be built.";
    }
  }

  return (
    <>
      <div className="py-8">
        <Crumbs items={[{ href: "/", label: "Home" }, { label: "Export" }]} />
        <SectionHead
          eyebrow="Takeaway artifact"
          title="The brief you hand to whoever is coming with you"
          lead="One page: the window worth driving for, every factor that produced the verdict, the conditions exactly as they were, where the data came from, and the chain seal so nobody can quietly edit the story later."
        />
      </div>

      <Band>
        {page.items.length === 0 ? (
          <EmptyState title="Nothing to export yet">
            Commit a session from a break page and it will show up here, ready to hand over.
          </EmptyState>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <nav aria-label="Sessions">
              <p className="label">Pick a session</p>
              <ul className="mt-2 space-y-2">
                {page.items.map((item) => {
                  const surfBreak = getBreak(item.breakId);
                  const active = item.id === selected;
                  return (
                    <li key={item.id}>
                      <Link
                        href={`/export?session=${item.id}`}
                        aria-current={active ? "true" : undefined}
                        className={`block border px-4 py-3 ${
                          active ? "border-ink bg-ink text-paper" : "border-rule bg-paper hover:border-ink"
                        }`}
                      >
                        <span className="font-display text-sm font-bold">{item.breakName}</span>
                        <span className={`label mt-0.5 block ${active ? "text-paper/70" : ""}`}>
                          {formatLocalStamp(item.plannedFor, surfBreak?.timezone ?? "UTC")} · {item.status} ·{" "}
                          {(item.score * 100).toFixed(0)}%
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>

            <div>
              {briefError ? (
                <Notice tone="block">
                  <p className="font-bold">That brief could not be built.</p>
                  <p className="mt-1">{briefError}</p>
                </Notice>
              ) : null}

              {!selected && !briefError ? (
                <EmptyState title="Choose a session on the left">
                  The brief is rendered from stored data, so it does not change if the weather does.
                </EmptyState>
              ) : null}

              {brief ? (
                <article className="border-2 border-ink bg-paper">
                  <header className="border-b-2 border-ink px-5 py-4">
                    <p className="label">Swellread brief · generated {brief.generatedAt.slice(0, 16).replace("T", " ")} UTC</p>
                    <h2 className="display mt-2 text-3xl">
                      {brief.session.breakName}, {brief.session.breakRegion}
                    </h2>
                    <p className="mt-1 text-sm text-ink-soft">
                      {brief.session.breakCountry} · {brief.session.breakType.replace("_", " ")} ·{" "}
                      {brief.session.coordinates.lat.toFixed(3)}, {brief.session.coordinates.lon.toFixed(3)} ·{" "}
                      {brief.session.timezone}
                    </p>
                  </header>

                  <div className="space-y-5 px-5 py-4">
                    <section>
                      <p className="label">The call</p>
                      <p className="mt-1 font-display text-xl font-bold">
                        {brief.engine.band.replace(/-/g, " ")} · {(brief.engine.score * 100).toFixed(0)}%
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-ink">{brief.engine.recommendation}</p>
                      <p className="mt-2 text-sm text-ink-soft">
                        Planned for{" "}
                        <strong className="text-ink">{formatLocalStamp(brief.session.plannedFor, brief.session.timezone)}</strong>{" "}
                        local · status {brief.session.status} · call {brief.session.call ?? "not recorded"} · confidence{" "}
                        {brief.session.confidence ?? "—"}
                      </p>
                    </section>

                    <section>
                      <p className="label">Window</p>
                      {brief.window.goodHours.length === 0 ? (
                        <p className="mt-1 text-sm text-ink-soft">No hour cleared the &quot;worth the drive&quot; bar.</p>
                      ) : (
                        <ul className="mt-1 flex flex-wrap gap-2">
                          {brief.window.goodHours.map((at) => (
                            <li key={at} className="border border-lagoon-deep bg-lagoon-wash px-2 py-1 font-mono text-xs text-lagoon-deep">
                              {formatLocalHour(at, brief.session.timezone)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>

                    <section>
                      <p className="label">Factor table</p>
                      <div className="scroll-thin mt-1 overflow-x-auto">
                        <table className="w-full min-w-[520px] border-collapse text-xs">
                          <thead>
                            <tr className="border-b border-ink text-left">
                              <th className="label py-1.5 pr-3">Factor</th>
                              <th className="label py-1.5 pr-3">Value</th>
                              <th className="label py-1.5 pr-3">Weight</th>
                              <th className="label py-1.5">Contribution</th>
                            </tr>
                          </thead>
                          <tbody>
                            {brief.engine.factors.map((factor) => (
                              <tr key={factor.key} className="border-b border-rule">
                                <td className="py-1.5 pr-3 font-mono text-ink">
                                  {factor.label}
                                  {!factor.available ? " (not scored)" : ""}
                                </td>
                                <td className="py-1.5 pr-3 text-ink-soft">{factor.rawLabel}</td>
                                <td className="data py-1.5 pr-3 text-ink-soft">{factor.effectiveWeight.toFixed(3)}</td>
                                <td className="data py-1.5 text-ink">{(factor.contribution * 100).toFixed(1)}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>

                    <section>
                      <p className="label">Frozen conditions ({brief.snapshotStatus})</p>
                      <div className="scroll-thin mt-1 overflow-x-auto">
                        <table className="w-full min-w-[520px] border-collapse text-xs">
                          <thead>
                            <tr className="border-b border-ink text-left">
                              <th className="label py-1.5 pr-3">Hour</th>
                              <th className="label py-1.5 pr-3">Swell</th>
                              <th className="label py-1.5 pr-3">Tp</th>
                              <th className="label py-1.5 pr-3">From</th>
                              <th className="label py-1.5 pr-3">Wind</th>
                              <th className="label py-1.5">Tide</th>
                            </tr>
                          </thead>
                          <tbody>
                            {brief.conditions.map((hour) => (
                              <tr key={hour.at} className="border-b border-rule">
                                <td className="data py-1.5 pr-3 text-ink">{formatLocalHour(hour.at, brief.session.timezone)}</td>
                                <td className="data py-1.5 pr-3 text-ink-soft">
                                  {hour.swellHeightM === null ? "—" : `${hour.swellHeightM.toFixed(2)} m`}
                                </td>
                                <td className="data py-1.5 pr-3 text-ink-soft">
                                  {hour.swellPeriodS === null ? "—" : `${hour.swellPeriodS.toFixed(0)} s`}
                                </td>
                                <td className="data py-1.5 pr-3 text-ink-soft">
                                  {hour.swellDirDeg === null ? "—" : `${Math.round(hour.swellDirDeg)}°`}
                                </td>
                                <td className="data py-1.5 pr-3 text-ink-soft">
                                  {hour.windSpeedMs === null ? "—" : `${hour.windSpeedMs.toFixed(1)} m/s`}
                                </td>
                                <td className="data py-1.5 text-ink-soft">
                                  {hour.tideM === null ? "no station" : `${hour.tideM.toFixed(2)} m`}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>

                    <section>
                      <p className="label">Rides logged</p>
                      {brief.rides.length === 0 ? (
                        <p className="mt-1 text-sm text-ink-soft">None logged against this session.</p>
                      ) : (
                        <ul className="mt-1 space-y-1 text-sm text-ink-soft">
                          {brief.rides.map((ride) => (
                            <li key={ride.id} className="data">
                              {ride.durationSec}s water time · longest {ride.longestRideSec}s · top{" "}
                              {ride.topSpeedKmh.toFixed(1)} km/h · {ride.completed ? "kicked out" : "caught by the closeout"}
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>

                    <section>
                      <p className="label">Integrity</p>
                      <p className="mt-1 text-sm text-ink-soft">
                        {brief.chain.length} event{brief.chain.length === 1 ? "" : "s"} ·{" "}
                        {brief.chain.ok ? "chain replays clean" : `broken at ${brief.chain.brokenAt}: ${brief.chain.reason}`}
                      </p>
                      <p className="mt-2">
                        <SealChip seal={brief.chain.headSeal} label="head seal" />
                      </p>
                    </section>

                    <section>
                      <p className="label">Data attribution</p>
                      <div className="mt-1">
                        <SourceList
                          sources={brief.sourceAttribution.map((source) => ({
                            ...source,
                            id: "bundled-sample" as const,
                            stale: source.status === "fallback",
                          }))}
                        />
                      </div>
                    </section>

                    <section>
                      <p className="label">Disclaimer</p>
                      <p className="mt-1 text-xs leading-relaxed text-ink-soft">{brief.disclaimer}</p>
                    </section>
                  </div>

                  <footer className="flex flex-wrap items-center gap-3 border-t-2 border-ink px-5 py-4">
                    <a
                      href={`/api/brief/${brief.session.id}?format=json`}
                      className="bg-rescue px-4 py-2.5 font-display text-sm font-bold text-paper hover:bg-abyss-deep"
                      download
                    >
                      Download the JSON brief
                    </a>
                    <Link
                      href={`/share/${brief.session.id}`}
                      className="border-2 border-ink px-4 py-2.5 font-display text-sm font-bold text-ink hover:bg-ink hover:text-paper"
                    >
                      Shareable route
                    </Link>
                    <RepoLink variant="outline" />
                  </footer>
                </article>
              ) : null}
            </div>
          </div>
        )}
      </Band>

      <Band>
        <p className="max-w-3xl text-xs leading-relaxed text-ink-faint">
          Built by {site.name} · engine {site.engineVersion} · {site.repository}. The brief is rendered from stored rows,
          so it is safe to print, attach or paste into a message and it will not drift.
        </p>
      </Band>
    </>
  );
}