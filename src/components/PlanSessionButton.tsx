"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, BookmarkPlus } from "lucide-react";
import { Notice } from "@/components/ui";

/**
 * Commits the hour you are looking at.
 *
 * This POSTs to /api/sessions, which re-fetches the live sources, re-runs the
 * shared engine, freezes both into a session, and appends the first sealed audit
 * event. An idempotency key is generated per click, so a double tap cannot create
 * two sessions.
 */
export function PlanSessionButton({
  breakId,
  plannedFor,
  hourLabel,
  band,
}: {
  breakId: string;
  plannedFor: string;
  hourLabel: string;
  band: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "saving" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function commit() {
    setState("saving");
    setError(null);
    try {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          breakId,
          plannedFor,
          status: "committed",
          idempotencyKey: `plan-${breakId}-${plannedFor}-${crypto.randomUUID()}`,
        }),
      });
      const body = (await response.json()) as {
        session?: { id: string };
        error?: { message: string };
      };
      if (!response.ok || !body.session) {
        setError(body.error?.message ?? `The session could not be saved (HTTP ${response.status}).`);
        setState("idle");
        return;
      }
      setState("done");
      router.push(`/sessions/${body.session.id}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The session could not be saved.");
      setState("idle");
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void commit()}
        disabled={state !== "idle"}
        className="inline-flex items-center gap-2 bg-rescue px-5 py-3 font-display text-sm font-bold tracking-tight text-paper hover:bg-abyss-deep disabled:cursor-not-allowed disabled:bg-ink-faint"
      >
        {state === "saving" ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <BookmarkPlus size={16} aria-hidden="true" />}
        {state === "done" ? "Saved" : state === "saving" ? "Saving…" : `Commit ${hourLabel} — ${band}`}
      </button>
      {error ? (
        <div className="mt-3 max-w-md">
          <Notice tone="block">
            <p className="font-bold">Nothing was saved.</p>
            <p className="mt-1">{error}</p>
          </Notice>
        </div>
      ) : null}
    </div>
  );
}