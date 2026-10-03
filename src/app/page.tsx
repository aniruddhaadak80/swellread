import Link from "next/link";
import { ArrowRight, Waves, Wind, Timer } from "lucide-react";
import { analyseBreak } from "@/lib/services/analysis";
import { formatLocalHour } from "@/lib/live/conditions";
import { getHeroBreak } from "@/lib/live/breaks";
import { site } from "@/config/site";
import { RepoLink } from "@/components/RepoLink";
import { GitHubMark } from "@/components/GitHubMark";
import { TideRibbon } from "@/components/TideRibbon";
import {
  Band,
  BAND_LABEL,
  BAND_STYLE,
  EngineSummary,
  Notice,
  SectionHead,
  SourceList,
  Stat,
} from "@/components/ui";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HomePage() {
  const heroBreak = getHeroBreak();
  let analysis: Awaited<ReturnType<typeof analyseBreak>> | null = null;
  let failure: string | null = null;
  try {
    analysis = await analyseBreak({ breakId: heroBreak.id });
  } catch (error) {
    failure = error instanceof Error ? error.message : "the conditions service did not answer";
  }

  const nowIndex = analysis?.currentIndex ?? null;
  const nowEngine = nowIndex === null ? null : (analysis?.engine ?? null);
  const point = nowIndex === null ? null : analysis?.points[nowIndex] ?? null;
  const hourLabel = point ? point.localLabel : "—";
  const window = analysis?.engine.window ?? null;

  return (
    <>
      <section className="py-10 sm:py-14">
        <p className="label">Built for the friend who drives two hours to a reef pass and hates being disappointed</p>
        <h1 className="display mt-4 max-w-4xl text-4xl sm:text-6xl">
          Read the water before you paddle out.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-ink-soft">
          Swellread turns today&apos;s real swell and wind from Open-Meteo, and today&apos;s verified tide predictions
          from NOAA CO-OPS, into one explainable verdict per break:{" "}
          <strong className="text-ink">which hours will actually peel</strong>, and whether the drive is worth it. Every
          number that moves the verdict is shown, and every plan you keep is sealed so you can prove later what the
          water was.
        </p>

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Link
            href={`/breaks/${heroBreak.id}`}
            className="inline-flex items-center gap-2 bg-rescue px-5 py-3 font-display text-sm font-bold tracking-tight text-paper hover:bg-abyss-deep"
          >
            Open today&apos;s board at {heroBreak.name}
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
          <Link
            href="/lab"
            className="inline-flex items-center gap-2 border-2 border-ink px-5 py-3 font-display text-sm font-bold tracking-tight text-ink hover:bg-ink hover:text-paper"
          >
            <Waves size={16} aria-hidden="true" />
            Ride the swell in 3D
          </Link>
          <RepoLink variant="outline" />
        </div>

        <p className="mt-4 flex items-center gap-2 font-mono text-xs text-ink-faint">
          <GitHubMark className="text-sm" />
          Everything is open source and MIT licensed — engine, data join, integrity chain and the WebGL lab.
        </p>
      </section>

      {failure ? (
        <Notice tone="block">
          <p className="font-bold">Today&apos;s live conditions could not be loaded.</p>
          <p className="mt-1">{failure}</p>
          <p className="mt-2">
            The rest of the app still works, and nothing here has been filled in with invented numbers. Try the{" "}
            <Link href="/method" className="underline underline-offset-4">
              method page
            </Link>{" "}
            or the{" "}
            <Link href="/api/health" className="underline underline-offset-4">
              health endpoint
            </Link>
            .
          </p>
        </Notice>
      ) : null}

      {analysis && nowEngine && point ? (
        <Band>
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <div>
              <p className="label">
                Right now at {heroBreak.name}, {heroBreak.region} · {hourLabel} local
              </p>
              <p className="display mt-3 text-5xl">{(nowEngine.score * 100).toFixed(0)}</p>
              <span className={`mt-3 inline-flex px-3 py-1.5 font-mono text-xs uppercase tracking-[0.12em] ${BAND_STYLE[nowEngine.band]}`}>
                {BAND_LABEL[nowEngine.band]}
              </span>

              <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Stat label="Swell" value={point.swellHeightM === null ? "—" : `${point.swellHeightM.toFixed(2)} m`} />
                <Stat label="Period" value={point.swellPeriodS === null ? "—" : `${point.swellPeriodS.toFixed(0)} s`} />
                <Stat label="Wind" value={point.windSpeedMs === null ? "—" : `${point.windSpeedMs.toFixed(1)} m/s`} />
                <Stat label="Tide" value={point.tideM === null ? "no station" : `${point.tideM.toFixed(2)} m`} hint="above MLLW" />
                <Stat label="Break height" value={nowEngine.derived.breakHeightM === null ? "—" : `${nowEngine.derived.breakHeightM.toFixed(2)} m`} />
                <Stat label="Peel speed" value={nowEngine.derived.peelSpeedKmh === null ? "—" : `${nowEngine.derived.peelSpeedKmh.toFixed(1)} km/h`} />
              </div>

              <div className="mt-6">
                <EngineSummary engine={nowEngine} />
              </div>
            </div>

            <div>
              <TideRibbon
                title="Today at Pago Pago, local time"
                caption={analysis.status === "fallback" ? "sealed offline sample — not today's water" : `${analysis.status} data`}
                points={analysis.points}
                activeIndex={nowIndex}
                currentIndex={nowIndex}
                hrefFor={(index) => `/breaks/${heroBreak.id}?hour=${index}`}
              />
              {window && window.goodHours.length > 0 ? (
                <p className="mt-3 text-sm text-ink">
                  <strong className="font-bold">
                    {window.goodHours.length} hour{window.goodHours.length === 1 ? "" : "s"} worth driving for
                  </strong>
                  , best at {formatLocalHour(window.bestHour ?? window.goodHours[0], heroBreak.timezone)} local.
                </p>
              ) : (
                <p className="mt-3 text-sm text-ink-soft">
                  No hour today clears the &quot;worth the drive&quot; bar. That is a real answer, and the ribbon shows why.
                </p>
              )}
              <p className="mt-3 text-xs text-ink-faint">
                Click any hour to open that hour at the break. The selection lives in the URL, so you can send someone
                the exact slice you are looking at.
              </p>
            </div>
          </div>
        </Band>
      ) : null}

      <Band>
        <SectionHead
          eyebrow="What the engine actually does"
          title="Six weighted factors, three hard gates, no black box"
          lead="One deterministic function, called by the page, the REST API and the MCP tools alike. Nothing is re-derived in a component."
        />
        <div className="grid gap-6 md:grid-cols-3">
          <article className="border-l-2 border-lagoon pl-4">
            <Timer size={18} className="text-lagoon-deep" aria-hidden="true" />
            <h3 className="mt-2 font-display text-lg font-bold">Peel speed is tide</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              Peel speed is shallow-water celerity, c = √(g·d). Drag the tide on any break page and the cross-section
              re-cuts, the peel re-solves and the shared engine re-runs on the server. That one relationship is the
              reason a &quot;1.2 m&quot; swell can be perfect at one hour and useless at the next.
            </p>
          </article>
          <article className="border-l-2 border-abyss pl-4">
            <Waves size={18} className="text-abyss" aria-hidden="true" />
            <h3 className="mt-2 font-display text-lg font-bold">Standing up, not just size</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              Wave power is P = ⅟₁₆ρgHs²Tp, and the height at the take-off comes from Green&apos;s law on the reef
              face, capped by the water you actually have. Size alone never sets the score.
            </p>
          </article>
          <article className="border-l-2 border-rescue pl-4">
            <Wind size={18} className="text-rescue" aria-hidden="true" />
            <h3 className="mt-2 font-display text-lg font-bold">Wind decides it</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              Wind quality multiplies the angle between where the wind is from and where the swell is from by a speed
              envelope. Ten degrees of offshore is worth more than any forecast icon.
            </p>
          </article>
        </div>
        <p className="mt-6">
          <Link href="/method" className="inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-[0.12em] text-rescue underline underline-offset-4">
            Read the full method
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </p>
      </Band>

      <Band>
        <SectionHead
          eyebrow="Three jobs this is built to do"
          title="Plan it, remember how it felt, hand someone else the brief"
        />
        <div className="grid gap-5 md:grid-cols-3">
          <article className="border border-rule bg-paper p-5">
            <p className="label">Job one</p>
            <h3 className="mt-2 font-display text-lg font-bold">Know the hours before you drive</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              Rank a day, then commit a session with the real conditions frozen into it.{" "}
              <Link href="/breaks" className="underline underline-offset-4">
                Pick a break
              </Link>
              .
            </p>
          </article>
          <article className="border border-rule bg-paper p-5">
            <p className="label">Job two</p>
            <h3 className="mt-2 font-display text-lg font-bold">Log what it felt like and find it again</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              Write one line about the water. A sentence-embedding model bundled in this repository runs entirely in your
              browser and retrieves your own past sessions that felt the same.{" "}
              <Link href="/lab" className="underline underline-offset-4">
                Ride and log
              </Link>
              .
            </p>
          </article>
          <article className="border border-rule bg-paper p-5">
            <p className="label">Job three</p>
            <h3 className="mt-2 font-display text-lg font-bold">Export a brief someone can act on</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              A shareable page with the exact window, every factor, the conditions table, full attribution and the chain
              seal.{" "}
              <Link href="/export" className="underline underline-offset-4">
                Export a brief
              </Link>
              .
            </p>
          </article>
        </div>
      </Band>

      <Band>
        <SectionHead
          eyebrow="Where the numbers come from"
          title="Two keyless public feeds, attributed honestly, with an offline fallback that says so"
        />
        {analysis ? <SourceList sources={analysis.snapshot.sources} /> : <p className="text-sm text-ink-soft">Sources are listed once the live feed answers.</p>}
        <p className="mt-4 max-w-3xl text-xs leading-relaxed text-ink-faint">
          When every upstream is unreachable the app shows a sealed, dated synthetic profile and labels the snapshot{" "}
          <code className="font-mono">fallback</code>. It never presents sample data as current, and it never
          substitutes it for anything you created. Where no NOAA tide station is in range for a break, the tide factor is
          dropped and the remaining weights are renormalised rather than guessing.
        </p>
      </Band>

      <Band>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <p className="label">Also in this repository</p>
            <ul className="mt-3 space-y-2 text-sm">
              {[
                { href: "/agent", label: "Agent console — a live MCP JSON-RPC endpoint with eight typed tools" },
                { href: "/verify", label: "Integrity replay — recompute any session's SHA-384 chain" },
                { href: "/method", label: "Method — every formula, weight and boundary case written down" },
                { href: "/settings", label: "Settings — units, the bundled model, and how ownership works" },
              ].map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="underline underline-offset-4 hover:text-rescue">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="label">This is a surf forecast, not a safety guarantee</p>
            <p className="mt-3 text-sm leading-relaxed text-ink-soft">
              Swellread describes the surface of the ocean. It does not know what is happening underneath it, and it
              cannot see your ability, your fitness or the state of the reef. Use it to decide when, then use your judgement
              out there. Engine {site.engineVersion}.
            </p>
            <p className="mt-4">
              <RepoLink variant="solid" />
            </p>
          </div>
        </div>
      </Band>
    </>
  );
}