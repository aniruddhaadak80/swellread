import Link from "next/link";
import { readSessions } from "@/lib/services/sessions";
import { currentOwnerId } from "@/lib/session/owner";
import { formatLocalStamp } from "@/lib/live/conditions";
import { getBreak } from "@/lib/live/breaks";
import type { SessionStatus } from "@/lib/types";
import { Band, BAND_LABEL, Crumbs, EmptyState, Notice, SectionHead, VerdictBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sessions",
  description: "Every session you have planned, the conditions frozen into it, and the seal on the chain that proves it was not edited.",
};

const STATUSES: Array<{ value: SessionStatus | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "planned", label: "Planned" },
  { value: "committed", label: "Committed" },
  { value: "skipped", label: "Skipped" },
  { value: "ridden", label: "Ridden" },
];

const STATUS_STYLE: Record<SessionStatus, string> = {
  planned: "bg-glass-deep text-ink border border-rule",
  committed: "bg-lagoon-deep text-paper",
  skipped: "bg-ink-soft text-paper",
  ridden: "bg-abyss text-paper",
};

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const statusRaw = typeof query.status === "string" ? query.status : "all";
  const status = STATUSES.some((entry) => entry.value === statusRaw) ? (statusRaw as SessionStatus | "all") : "all";
  const breakFilter = typeof query.break === "string" ? query.break : null;
  const page = Math.max(0, Number(typeof query.page === "string" ? query.page : "0") || 0);
  const perPage = 10;

  const ownerId = await currentOwnerId();
  const page_data = await readSessions(ownerId, {
    status: status === "all" ? null : status,
    breakId: breakFilter,
    limit: perPage,
    offset: page * perPage,
  });

  const buildHref = (next: { status?: string; break?: string | null; page?: number }) => {
    const params = new URLSearchParams();
    const nextStatus = next.status ?? (status === "all" ? "" : status);
    if (nextStatus) params.set("status", nextStatus);
    const nextBreak = next.break === undefined ? breakFilter : next.break;
    if (nextBreak) params.set("break", nextBreak);
    const nextPage = next.page ?? 0;
    if (nextPage > 0) params.set("page", String(nextPage));
    const queryString = params.toString();
    return queryString ? `/sessions?${queryString}` : "/sessions";
  };

  return (
    <>
      <div className="py-10">
        <Crumbs items={[{ href: "/", label: "Home" }, { label: "Sessions" }]} />
        <SectionHead
          eyebrow="Your workspace"
          title="Every plan you have frozen, and the seal on it"
          lead="A session stores the conditions exactly as they were when you committed it, plus the engine verdict that told you to. Filter and paging live in the URL, so a filtered view is a link you can send."
          right={
            <Link
              href="/breaks"
              className="inline-flex items-center gap-2 bg-rescue px-4 py-2.5 font-display text-sm font-bold text-paper hover:bg-abyss-deep"
            >
              Plan a new session
            </Link>
          }
        />
      </div>

      <Band>
        <nav aria-label="Filters" className="flex flex-wrap items-center gap-2">
          <span className="label mr-1">Status</span>
          {STATUSES.map((entry) => (
            <Link
              key={entry.value}
              href={buildHref({ status: entry.value === "all" ? "" : entry.value, page: 0 })}
              aria-current={status === entry.value ? "true" : undefined}
              className={`border px-3 py-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.1em] ${
                status === entry.value ? "border-ink bg-ink text-paper" : "border-rule bg-paper text-ink-soft hover:border-ink"
              }`}
            >
              {entry.label}
            </Link>
          ))}
          {breakFilter ? (
            <Link href={buildHref({ break: null })} className="border border-rescue bg-rescue/10 px-3 py-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.1em] text-rescue">
              {getBreak(breakFilter)?.name ?? breakFilter} ✕
            </Link>
          ) : null}
        </nav>

        {page_data.total === 0 ? (
          <div className="mt-6">
            <EmptyState title="No sessions here yet">
              Open a break, pick an hour on the ribbon, and commit it. That writes a real row with a real conditions
              snapshot and the first link of its integrity chain.{" "}
              <Link href="/breaks" className="underline underline-offset-4">
                Pick a break
              </Link>
              .
            </EmptyState>
          </div>
        ) : (
          <>
            <p className="mt-5 font-mono text-xs text-ink-faint">
              {page_data.total} session{page_data.total === 1 ? "" : "s"} · showing {page_data.items.length} ·{" "}
              {page * perPage + 1}–{page * perPage + page_data.items.length}
            </p>

            <ul className="mt-4 space-y-3">
              {page_data.items.map((session) => {
                const surfBreak = getBreak(session.breakId);
                return (
                  <li key={session.id} className="border border-rule bg-paper">
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-rule px-4 py-3">
                      <div>
                        <h2 className="font-display text-lg font-bold leading-tight">
                          <Link href={`/sessions/${session.id}`} className="underline-offset-4 hover:underline">
                            {surfBreak?.name ?? session.breakId}
                          </Link>
                        </h2>
                        <p className="label mt-0.5">
                          {formatLocalStamp(session.plannedFor, surfBreak?.timezone ?? "UTC")} local · {surfBreak?.country ?? ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`px-2 py-1 font-mono text-[0.6875rem] uppercase tracking-[0.1em] ${STATUS_STYLE[session.status]}`}>
                          {session.status}
                        </span>
                        <VerdictBadge band={session.band} score={session.score} />
                      </div>
                    </div>

                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-5">
                      <div>
                        <dt className="label">Swell</dt>
                        <dd className="data mt-0.5 text-sm font-bold">
                          {session.swellHeightM === null ? "—" : `${session.swellHeightM.toFixed(2)} m`}
                        </dd>
                      </div>
                      <div>
                        <dt className="label">Period</dt>
                        <dd className="data mt-0.5 text-sm font-bold">
                          {session.swellPeriodS === null ? "—" : `${session.swellPeriodS.toFixed(0)} s`}
                        </dd>
                      </div>
                      <div>
                        <dt className="label">Wind</dt>
                        <dd className="data mt-0.5 text-sm font-bold">
                          {session.windSpeedMs === null ? "—" : `${session.windSpeedMs.toFixed(1)} m/s`}
                        </dd>
                      </div>
                      <div>
                        <dt className="label">Tide</dt>
                        <dd className="data mt-0.5 text-sm font-bold">
                          {session.tideM === null ? "no station" : `${session.tideM.toFixed(2)} m`}
                        </dd>
                      </div>
                      <div>
                        <dt className="label">Rides</dt>
                        <dd className="data mt-0.5 text-sm font-bold">
                          {session.rideCount} · longest {session.longestRideSec}s
                        </dd>
                      </div>
                    </dl>

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-rule px-4 py-3">
                      <span className="text-xs text-ink-faint">
                        Frozen at {new Date(session.createdAt).toISOString().slice(0, 16).replace("T", " ")} UTC
                      </span>
                      <span className="flex items-center gap-3 font-mono text-[0.6875rem] uppercase tracking-[0.1em]">
                        <Link href={`/share/${session.id}`} className="text-ink-soft hover:text-rescue">
                          Share route
                        </Link>
                        <Link href={`/sessions/${session.id}`} className="text-rescue underline underline-offset-4">
                          Open and decide
                        </Link>
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>

            <nav aria-label="Pagination" className="mt-5 flex items-center justify-between gap-3">
              {page > 0 ? (
                <Link href={buildHref({ page: page - 1 })} className="border border-rule bg-paper px-3 py-2 font-mono text-xs uppercase tracking-[0.1em] hover:border-ink">
                  ← Newer
                </Link>
              ) : (
                <span />
              )}
              {page * perPage + page_data.items.length < page_data.total ? (
                <Link href={buildHref({ page: page + 1 })} className="border border-rule bg-paper px-3 py-2 font-mono text-xs uppercase tracking-[0.1em] hover:border-ink">
                  Older →
                </Link>
              ) : (
                <span className="font-mono text-xs text-ink-faint">end of list</span>
              )}
            </nav>
          </>
        )}

        <div className="mt-8">
          <Notice tone="info">
            Sessions are owned by an anonymous HTTP-only cookie minted for this browser. There is no account, and no
            session of yours is reachable from another browser. Clearing the cookie loses access to these rows — which is
            why the seal chain and the exportable brief matter more here than the database row does.
          </Notice>
        </div>
      </Band>

      <Band>
        <p className="text-xs text-ink-faint">
          Bands: {BAND_LABEL["get-in"]} ≥70%, {BAND_LABEL["worth-the-drive"]} ≥50%, {BAND_LABEL.marginal} ≥30%,{" "}
          {BAND_LABEL["stay-home"]} below that, {BAND_LABEL.flat} when there is no usable swell.
        </p>
      </Band>
    </>
  );
}