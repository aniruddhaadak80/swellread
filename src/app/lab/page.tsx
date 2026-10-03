import Link from "next/link";
import { analyseBreak } from "@/lib/services/analysis";
import { readSession, readSessions } from "@/lib/services/sessions";
import { currentOwnerId } from "@/lib/session/owner";
import { getBreak } from "@/lib/live/breaks";
import { formatLocalStamp } from "@/lib/live/conditions";
import { WaveLabLoader } from "@/components/lab/WaveLabLoader";
import type { LabConditions } from "@/components/lab/WaveLab";
import { Band, Crumbs, Notice, SectionHead } from "@/components/ui";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Wave lab",
  description:
    "A WebGL wave whose amplitude, period and heading come from real data, breaking on a seabed profile at H/d = 0.78, peeling at c = √(g·depth). Ride the pocket.",
};

export default async function LabPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const sessionId = typeof query.session === "string" ? query.session : null;
  const breakParam = typeof query.break === "string" ? query.break : "pago-pago";
  const hourParam = typeof query.hour === "string" ? Number(query.hour) : 0;
  const hour = Number.isFinite(hourParam) ? Math.min(23, Math.max(0, Math.round(hourParam))) : 0;

  const ownerId = await currentOwnerId();

  // Preferred path: ride the swell that was frozen into a session.
  let session = null;
  if (sessionId) {
    session = await readSession(ownerId, sessionId);
  }

  let conditions: LabConditions | null = null;
  let sourceLabel = "";
  let failure: string | null = null;

  if (session) {
    const hourRow =
      session.conditions.hours.find((row) => row.at === session.plannedFor) ?? session.conditions.hours[0];
    const surfBreak = getBreak(session.breakId);
    conditions = {
      breakName: surfBreak?.name ?? session.breakId,
      breakType: surfBreak?.breakType ?? "unknown",
      swellHeightM: hourRow?.swellHeightM ?? null,
      swellPeriodS: hourRow?.swellPeriodS ?? null,
      swellDirDeg: hourRow?.swellDirDeg ?? null,
      windSpeedMs: hourRow?.windSpeedMs ?? null,
      windDirDeg: hourRow?.windDirDeg ?? null,
      tideM: hourRow?.tideM ?? null,
      depthAtBreakM: surfBreak?.depthAtBreakM ?? 1.2,
      peelSpeedKmh: session.engine.derived.peelSpeedKmh,
      breakHeightM: session.engine.derived.breakHeightM,
      band: session.engine.band,
      score: session.engine.score,
      sourceLabel: `Riding the conditions frozen into session ${session.id.slice(0, 8)} on ${formatLocalStamp(
        session.plannedFor,
        surfBreak?.timezone ?? "UTC",
      )} local. These are stored numbers, so this scene does not change with the weather.`,
    };
    sourceLabel = conditions.sourceLabel;
  } else {
    try {
      const analysis = await analyseBreak({ breakId: breakParam, hour });
      conditions = {
        breakName: analysis.break.name,
        breakType: analysis.break.breakType,
        swellHeightM: analysis.hour.swellHeightM ?? analysis.hour.waveHeightM,
        swellPeriodS: analysis.hour.swellPeriodS,
        swellDirDeg: analysis.hour.swellDirDeg ?? analysis.hour.waveDirDeg,
        windSpeedMs: analysis.hour.windSpeedMs,
        windDirDeg: analysis.hour.windDirDeg,
        tideM: analysis.hour.tideM,
        depthAtBreakM: analysis.break.depthAtBreakM,
        peelSpeedKmh: analysis.engine.derived.peelSpeedKmh,
        breakHeightM: analysis.engine.derived.breakHeightM,
        band: analysis.engine.band,
        score: analysis.engine.score,
        sourceLabel: `Live ${analysis.status} read at ${analysis.points[hour]?.localLabel ?? ""} local, ${analysis.break.name}. The engine rated this hour ${(analysis.engine.score * 100).toFixed(0)}%.`,
      };
      sourceLabel = conditions.sourceLabel;
    } catch (error) {
      failure = error instanceof Error ? error.message : "the conditions service did not answer";
    }
  }

  const planned = await readSessions(ownerId, { limit: 8 });

  return (
    <>
      <div className="py-8">
        <Crumbs items={[{ href: "/", label: "Home" }, { label: "Wave lab" }]} />
        <SectionHead
          eyebrow="WebGL"
          title="Ride the swell, not a stock clip"
          lead="The surface is a Gerstner sum built from the same height, period and heading the rest of the app uses. It only breaks where the water is shallow enough, and the peel travels at c = √(g·depth) — so what you are holding onto is a consequence of the tide, not a scripted animation."
          right={
            session ? (
              <Link
                href={`/sessions/${session.id}`}
                className="border-2 border-ink px-4 py-2.5 font-display text-sm font-bold text-ink hover:bg-ink hover:text-paper"
              >
                Back to session
              </Link>
            ) : (
              <Link
                href="/breaks"
                className="border-2 border-ink px-4 py-2.5 font-display text-sm font-bold text-ink hover:bg-ink hover:text-paper"
              >
                Pick a break
              </Link>
            )
          }
        />
      </div>

      {failure && !conditions ? (
        <Notice tone="block">
          <p className="font-bold">The lab needs a swell to ride and none could be loaded.</p>
          <p className="mt-1">{failure}</p>
          <p className="mt-2">
            Nothing has been substituted. Open a session and ride its frozen conditions instead, or{" "}
            <Link href="/method" className="underline underline-offset-4">
              read the method
            </Link>
            .
          </p>
        </Notice>
      ) : null}

      {conditions ? (
        <>
          <WaveLabLoader conditions={conditions} sessionId={session?.id ?? null} />
          <p className="mt-3 font-mono text-[0.6875rem] text-ink-faint">{sourceLabel}</p>
        </>
      ) : null}

      <Band>
        <SectionHead eyebrow="Honest limits" title="What this scene is and is not" />
        <ul className="grid gap-4 text-sm leading-relaxed text-ink-soft sm:grid-cols-2">
          <li className="border-l-2 border-lagoon pl-3">
            <strong className="text-ink">It is:</strong> a Gerstner surface with real swell parameters, a real seabed
            profile, breaking at the real 0.78 depth ratio, and a peel speed taken from the engine&apos;s own physics.
            The numbers in the panel beside it are the engine&apos;s numbers.
          </li>
          <li className="border-l-2 border-rescue pl-3">
            <strong className="text-ink">It is not:</strong> a CFD simulation, and the riding is a score rather than a
            physics engine with a real surfer on it. Take the water model seriously and the gameplay lightly.
          </li>
          <li className="border-l-2 border-abyss pl-3">
            <strong className="text-ink">Keyboard first:</strong> it is fully playable with A/D, W, S and Space. It also
            responds to the arrow keys. There is nothing here that only works with a pointer.
          </li>
          <li className="border-l-2 border-rule pl-3">
            <strong className="text-ink">Reduced motion:</strong> if your system asks for reduced motion the scene still
            runs, because it is the only way to interact with it. Everything else on the site respects that setting.
          </li>
        </ul>
      </Band>

      <Band>
        <SectionHead eyebrow="Attach a ride" title="Open the lab from one of your sessions" />
        {planned.items.length === 0 ? (
          <p className="text-sm text-ink-soft">
            You have no sessions yet. Commit an hour from a break page and it will show up here — then any ride you log
            is written to that session through the same endpoint the agent&apos;s{" "}
            <code className="font-mono">log_ride</code> tool calls.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {planned.items.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/lab?session=${item.id}`}
                  className="block border border-rule bg-paper px-4 py-3 hover:border-ink"
                >
                  <span className="font-display text-sm font-bold">
                    {item.breakName} · {formatLocalStamp(item.plannedFor, getBreak(item.breakId)?.timezone ?? "UTC")}
                  </span>
                  <span className="label mt-0.5 block">
                    {item.status} · {(item.score * 100).toFixed(0)}% · {item.rideCount} ride{item.rideCount === 1 ? "" : "s"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Band>
    </>
  );
}