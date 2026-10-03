import Link from "next/link";
import { readSession, verifySessionChain } from "@/lib/services/sessions";
import { currentOwnerId } from "@/lib/session/owner";
import { getBreak } from "@/lib/live/breaks";
import { GENESIS_SEAL } from "@/lib/integrity/canonical";
import { Band, Crumbs, EmptyState, Notice, SectionHead, SealChip } from "@/components/ui";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Integrity replay",
  description:
    "Recompute any session's SHA-384 audit chain from the genesis value and find the first broken link, if there is one.",
};

export default async function VerifyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const id = typeof query.id === "string" ? query.id : null;
  const ownerId = await currentOwnerId();

  const session = id ? await readSession(ownerId, id) : null;
  const chain = id ? await verifySessionChain(ownerId, id) : null;
  const notYours = Boolean(id && !session && chain && chain.length === 0);

  return (
    <>
      <div className="py-8">
        <Crumbs items={[{ href: "/", label: "Home" }, { label: "Integrity replay" }]} />
        <SectionHead
          eyebrow="Tamper evidence"
          title="Recompute the chain and find the first broken link"
          lead="Every create, update, decision, ride and delete is appended to a per-entity chain. This page recomputes all of it from the genesis value using the same canonical JSON the writer used, and names the first sequence where the two disagree."
        />
      </div>

      <Band>
        <form action="/verify" method="get" className="flex flex-wrap items-end gap-3">
          <div className="min-w-[260px] flex-1">
            <label htmlFor="verify-id" className="label">
              Session id
            </label>
            <input
              id="verify-id"
              name="id"
              defaultValue={id ?? ""}
              placeholder="00000000-0000-0000-0000-000000000000"
              className="mt-1 w-full border border-rule bg-paper px-3 py-2 font-mono text-sm"
            />
          </div>
          <button type="submit" className="bg-ink px-5 py-2.5 font-display text-sm font-bold text-paper hover:bg-abyss-deep">
            Replay
          </button>
        </form>

        <div className="mt-6 space-y-4">
          {!id ? (
            <EmptyState title="Paste a session id to replay its chain">
              Every session page links straight to this tool with its id filled in.{" "}
              <Link href="/sessions" className="underline underline-offset-4">
                Open your sessions
              </Link>
              .
            </EmptyState>
          ) : null}

          {notYours ? (
            <Notice tone="warn">
              <p className="font-bold">No chain for that id in this browser.</p>
              <p className="mt-1">
                Sessions are scoped to the anonymous cookie that created them, so an id from another browser is
                indistinguishable from one that does not exist. That is deliberate.
              </p>
            </Notice>
          ) : null}

          {chain && chain.length > 0 ? (
            <>
              <div
                className={`border-l-4 px-4 py-3 text-sm ${
                  chain.ok ? "border-lagoon-deep bg-lagoon-wash text-abyss-deep" : "border-alert bg-alert/10 text-alert"
                }`}
              >
                <p className="font-bold">{chain.ok ? "Chain replays clean." : "Chain is broken."}</p>
                <p className="mt-1">
                  {chain.ok
                    ? `${chain.length} event${chain.length === 1 ? "" : "s"} recomputed from genesis; every link matches the stored seal.`
                    : `First broken link at sequence ${chain.brokenAt}: ${chain.reason}`}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <SealChip seal={chain.headSeal} label="head seal" />
                {session ? (
                  <Link
                    href={`/sessions/${chain.entityId}`}
                    className="font-mono text-xs uppercase tracking-[0.12em] text-rescue underline underline-offset-4"
                  >
                    {getBreak(session.breakId)?.name ?? session.breakId} → session page
                  </Link>
                ) : (
                  <span className="font-mono text-xs text-ink-faint">session is tombstoned or deleted</span>
                )}
              </div>

              <ol className="space-y-2">
                {chain.events.map((event) => (
                  <li key={`${event.seq}-${event.seal}`} className="border border-rule bg-paper px-4 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-mono text-xs uppercase tracking-[0.1em] text-ink">
                        {event.seq}. {event.action}
                      </span>
                      <span className="data text-[0.6875rem] text-ink-faint">
                        {new Date(event.createdAt).toISOString().replace("T", " ").slice(0, 19)} UTC
                      </span>
                    </div>
                    <p className="mt-1 break-all font-mono text-[0.6875rem] text-ink-soft">
                      prev {event.prevSeal.slice(0, 24)}…
                      <br />
                      seal {event.seal.slice(0, 24)}…
                    </p>
                    <details className="mt-1">
                      <summary className="cursor-pointer font-mono text-[0.6875rem] text-rescue">payload</summary>
                      <pre className="scroll-thin mt-1 max-h-40 overflow-auto bg-glass px-2 py-2 font-mono text-[0.6875rem]">
                        {JSON.stringify(event.payload, null, 2)}
                      </pre>
                    </details>
                  </li>
                ))}
              </ol>
            </>
          ) : null}
        </div>
      </Band>

      <Band>
        <SectionHead eyebrow="The rule" title="Exactly what is hashed" />
        <div className="border border-rule bg-paper p-5">
          <p className="data text-sm">seal_n = SHA-384( UTF-8(prevSeal) || canonicalJson(event_n) )</p>
          <p className="data mt-2 text-sm text-ink-soft">genesis = {GENESIS_SEAL}</p>
          <ul className="mt-4 space-y-2 text-sm leading-relaxed text-ink-soft">
            <li>
              The hashed body is exactly six fields: <code className="font-mono">seq</code>,{" "}
              <code className="font-mono">entityType</code>, <code className="font-mono">entityId</code>,{" "}
              <code className="font-mono">action</code>, <code className="font-mono">createdAt</code> and{" "}
              <code className="font-mono">payload</code>.
            </li>
            <li>
              <code className="font-mono">seal</code> and <code className="font-mono">prevSeal</code> are stored beside
              the body, never inside it, so editing a stored seal cannot be laundered by re-hashing.
            </li>
            <li>
              Canonical JSON sorts object keys recursively and keeps array order, so the same event always produces the
              same bytes regardless of which client wrote it.
            </li>
            <li>
              Delete keeps a tombstone, which is why a deleted session still replays. The{" "}
              <code className="font-mono">session.delete</code> event is the last link.
            </li>
          </ul>
        </div>
      </Band>
    </>
  );
}