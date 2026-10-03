import Link from "next/link";
import { notFound } from "next/navigation";
import { readSession, readSessions, verifySessionChain } from "@/lib/services/sessions";
import { currentOwnerId } from "@/lib/session/owner";
import { getBreak } from "@/lib/live/breaks";
import { formatLocalStamp } from "@/lib/live/conditions";
import { FeelMatch } from "@/components/FeelMatch";
import { SessionActions } from "@/components/SessionActions";
import {
  Band,
  Crumbs,
  EngineSummary,
  Notice,
  SectionHead,
  SealChip,
  SourceList,
  Stat,
} from "@/components/ui";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `Session ${id.slice(0, 8)}` };
}

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ownerId = await currentOwnerId();
  const session = await readSession(ownerId, id);
  if (!session) notFound();

  const [chain, others] = await Promise.all([
    verifySessionChain(ownerId, id),
    readSessions(ownerId, { limit: 50 }),
  ]);

  const surfBreak = getBreak(session.breakId);
  const plannedHour = session.conditions.hours.find((hour) => hour.at === session.plannedFor) ?? session.conditions.hours[0];
  const past = others.items
    .filter((item) => item.id !== session.id)
    .map((item) => ({
      id: item.id,
      label: item.breakName,
      when: formatLocalStamp(item.plannedFor, getBreak(item.breakId)?.timezone ?? "UTC"),
      conditions: `${item.swellHeightM === null ? "?" : item.swellHeightM.toFixed(2)} m @ ${item.swellPeriodS === null ? "?" : item.swellPeriodS.toFixed(0)} s`,
      embedding: null,
    }));

  return (
    <>
      <div className="py-8">
        <Crumbs
          items={[
            { href: "/", label: "Home" },
            { href: "/sessions", label: "Sessions" },
            { label: session.id.slice(0, 8) },
          ]}
        />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-3xl">
            <p className="label">
              {surfBreak?.region}, {surfBreak?.country} · planned for {formatLocalStamp(session.plannedFor, surfBreak?.timezone ?? "UTC")} local
            </p>
            <h1 className="display mt-2 text-4xl">{surfBreak?.name ?? session.breakId}</h1>
            <p className="mt-2 text-sm text-ink-soft">
              Session <span className="data">{session.id}</span> · version {session.version} · created{" "}
              {new Date(session.createdAt).toISOString().slice(0, 16).replace("T", " ")} UTC
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/share/${session.id}`}
              className="border-2 border-ink px-4 py-2.5 font-display text-sm font-bold text-ink hover:bg-ink hover:text-paper"
            >
              Share route
            </Link>
            <Link
              href={`/export?session=${session.id}`}
              className="border-2 border-ink px-4 py-2.5 font-display text-sm font-bold text-ink hover:bg-ink hover:text-paper"
            >
              Export brief
            </Link>
          </div>
        </div>

        {session.deletedAt ? (
          <div className="mt-5">
            <Notice tone="warn">
              This session was deleted at {new Date(session.deletedAt).toISOString().slice(0, 16).replace("T", " ")} UTC.
              The row is hidden everywhere except the chain, which still replays cleanly below — that is the documented
              tombstone behaviour, not a bug.
            </Notice>
          </div>
        ) : null}
      </div>

      <Band>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <p className="label">The verdict you were given, frozen</p>
            <div className="mt-3">
              <EngineSummary engine={session.engine} />
            </div>
            <p className="mt-4 font-mono text-xs text-ink-faint">engine seal {session.engine.seal}</p>

            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Stat label="Swell" value={plannedHour?.swellHeightM === null || !plannedHour ? "—" : `${plannedHour.swellHeightM.toFixed(2)} m`} />
              <Stat label="Period" value={plannedHour?.swellPeriodS === null || !plannedHour ? "—" : `${plannedHour.swellPeriodS.toFixed(0)} s`} />
              <Stat label="Wind" value={plannedHour?.windSpeedMs === null || !plannedHour ? "—" : `${plannedHour.windSpeedMs.toFixed(1)} m/s`} />
              <Stat label="Tide" value={plannedHour?.tideM === null || !plannedHour ? "no station" : `${plannedHour.tideM.toFixed(2)} m`} hint="above MLLW" />
              <Stat label="Break height" value={session.engine.derived.breakHeightM === null ? "—" : `${session.engine.derived.breakHeightM.toFixed(2)} m`} />
              <Stat label="Peel speed" value={session.engine.derived.peelSpeedKmh === null ? "—" : `${session.engine.derived.peelSpeedKmh.toFixed(1)} km/h`} />
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              <Link
                href={`/lab?session=${session.id}`}
                className="inline-flex items-center gap-2 bg-rescue px-4 py-2.5 font-display text-sm font-bold text-paper hover:bg-abyss-deep"
              >
                Ride this swell in the lab
              </Link>
              <Link
                href={`/breaks/${session.breakId}?hour=${Math.max(0, session.conditions.hours.findIndex((hour) => hour.at === session.plannedFor))}`}
                className="border-2 border-ink px-4 py-2.5 font-display text-sm font-bold text-ink hover:bg-ink hover:text-paper"
              >
                Open the live board
              </Link>
            </div>
          </div>

          <div>
            <p className="label">Decide, annotate, or delete</p>
            <div className="mt-3">
              <SessionActions
                sessionId={session.id}
                status={session.status}
                call={session.call}
                confidence={session.confidence}
                note={session.note}
                disabled={Boolean(session.deletedAt)}
              />
            </div>
          </div>
        </div>
      </Band>

      <Band>
        <SectionHead
          eyebrow="Feel memory"
          title="What the water felt like, and the sessions that felt the same"
          lead="A sentence encoder bundled with this repository runs in this tab. Your note never leaves the device, and nothing on this page depends on the model loading."
        />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <FeelMatch sessionId={session.id} note={session.note ?? ""} savedEmbedding={session.embedding} past={past} />
          <div>
            <p className="label">Logged rides</p>
            {session.rides.length === 0 ? (
              <p className="mt-2 text-sm text-ink-soft">
                No rides logged yet. The{" "}
                <Link href={`/lab?session=${session.id}`} className="underline underline-offset-4">
                  wave lab
                </Link>{" "}
                writes to the same endpoint the agent&apos;s <code className="font-mono">log_ride</code> tool calls.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {session.rides.map((ride) => (
                  <li key={ride.id} className="flex flex-wrap items-baseline justify-between gap-2 border border-rule bg-paper px-4 py-3">
                    <span className="data text-sm">
                      {ride.durationSec}s water time · longest {ride.longestRideSec}s · top {ride.topSpeedKmh.toFixed(1)} km/h
                    </span>
                    <span className={`px-2 py-0.5 font-mono text-[0.6875rem] uppercase tracking-[0.1em] ${ride.completed ? "bg-lagoon-deep text-paper" : "bg-rescue text-paper"}`}>
                      {ride.completed ? "completed" : "caught by the closeout"}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <p className="label mt-6">Snapshot status</p>
            <p className="mt-1 text-sm text-ink-soft">
              This session froze a <strong className="text-ink">{session.conditions.status}</strong> snapshot of{" "}
              {session.conditions.sources.length} source{session.conditions.sources.length === 1 ? "" : "s"} on{" "}
              {session.conditions.date}. Re-running the app now will not change these numbers.
            </p>
          </div>
        </div>
      </Band>

      <Band>
        <SectionHead
          eyebrow="Integrity"
          title="The audit chain for this session"
          right={<SealChip seal={chain.headSeal} label="head" />}
        />
        <div
          className={`border-l-4 px-4 py-3 text-sm ${
            chain.ok ? "border-lagoon-deep bg-lagoon-wash text-abyss-deep" : "border-alert bg-alert/10 text-alert"
          }`}
        >
          <p className="font-bold">{chain.ok ? "Chain replays clean." : "Chain is broken."}</p>
          <p className="mt-1">
            {chain.ok
              ? `${chain.length} event${chain.length === 1 ? "" : "s"}, each linked to the one before it, recomputed from the genesis value.`
              : `First broken link at sequence ${chain.brokenAt}: ${chain.reason}`}
          </p>
        </div>

        <ol className="mt-4 space-y-2">
          {chain.events.map((event) => (
            <li key={`${event.seq}-${event.seal}`} className="border border-rule bg-paper px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono text-xs uppercase tracking-[0.1em] text-ink">
                  {event.seq}. {event.action}
                </span>
                <span className="data text-[0.6875rem] text-ink-faint">
                  {new Date(event.createdAt).toISOString().slice(0, 16).replace("T", " ")} UTC
                </span>
              </div>
              <p className="mt-1 break-all font-mono text-[0.6875rem] text-ink-soft">
                prev {event.prevSeal.slice(0, 20)}… → {event.seal.slice(0, 20)}…
              </p>
              <details className="mt-1">
                <summary className="cursor-pointer font-mono text-[0.6875rem] text-rescue">payload</summary>
                <pre className="scroll-thin mt-1 max-h-40 overflow-auto bg-glass px-2 py-2 font-mono text-[0.6875rem] text-ink-soft">
                  {JSON.stringify(event.payload, null, 2)}
                </pre>
              </details>
            </li>
          ))}
        </ol>

        <p className="mt-4 font-mono text-xs text-ink-faint">
          seal_n = SHA-384( UTF-8(prevSeal) || canonicalJson(event_n) ) · genesis = 96 zeros
        </p>
        <p className="mt-2">
          <Link href={`/verify?id=${session.id}`} className="font-mono text-xs uppercase tracking-[0.12em] text-rescue underline underline-offset-4">
            Open it in the replay tool
          </Link>
        </p>
      </Band>

      <Band>
        <SectionHead eyebrow="Provenance of the frozen snapshot" title="Where these numbers came from" />
        <SourceList sources={session.conditions.sources} />
        <p className="mt-4 text-xs text-ink-faint">
          Conditions frozen at {session.conditions.generatedAt}. Each row is labelled live or fallback exactly as it was
          when this session was written.
        </p>
      </Band>
    </>
  );
}