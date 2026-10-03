"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Notice } from "@/components/ui";

/**
 * The decide-and-edit loop on one session, and the destructive operation.
 *
 * Everything here PATCHes or DELETEs the same REST routes the agent tools call,
 * and each successful write returns the new chain seal.
 */
export function SessionActions({
  sessionId,
  status,
  call,
  confidence,
  note,
  disabled = false,
}: {
  sessionId: string;
  status: string;
  call: string | null;
  confidence: number | null;
  note: string | null;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"call" | "note" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draftNote, setDraftNote] = useState(note ?? "");
  const [draftConfidence, setDraftConfidence] = useState(confidence ?? 3);
  const [lastSeal, setLastSeal] = useState<string | null>(null);

  async function send(body: unknown, kind: "call" | "note" | "delete") {
    setBusy(kind);
    setError(null);
    try {
      const response = await fetch(`/api/sessions/${sessionId}`, {
        method: kind === "delete" ? "DELETE" : "PATCH",
        headers: kind === "delete" ? undefined : { "content-type": "application/json" },
        body: kind === "delete" ? undefined : JSON.stringify(body),
      });
      const payload = (await response.json()) as {
        audit?: { seal?: string };
        error?: { message: string };
      };
      if (!response.ok) {
        setError(payload.error?.message ?? `The request failed with HTTP ${response.status}.`);
        return;
      }
      if (payload.audit?.seal) setLastSeal(payload.audit.seal);
      setConfirmDelete(false);
      router.refresh();
      if (kind === "delete") router.push("/sessions");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The request could not be sent.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      {disabled ? (
        <Notice tone="info">
          This session has been deleted. A tombstone and its full audit chain are kept so the history stays
          replayable, but it can no longer be edited.
        </Notice>
      ) : (
        <>
          <div>
            <p className="label">Your call</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {(["in", "out"] as const).map((value) => {
                const active = call === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => void send({ call: value, status: value === "in" ? "committed" : "skipped", confidence: draftConfidence }, "call")}
                    disabled={busy !== null}
                    aria-pressed={active}
                    className={`inline-flex items-center gap-2 border-2 px-4 py-2 font-display text-sm font-bold disabled:opacity-50 ${
                      active ? "border-ink bg-ink text-paper" : "border-rule bg-paper text-ink hover:border-ink"
                    }`}
                  >
                    {busy === "call" && active ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : null}
                    {value === "in" ? "I'm going" : "Staying home"}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 font-mono text-[0.6875rem] text-ink-faint">
              current status {status}
              {call ? ` · call ${call}` : " · no call recorded"}
              {lastSeal ? ` · last write sealed ${lastSeal.slice(0, 12)}…` : ""}
            </p>
          </div>

          <div>
            <label htmlFor="confidence" className="label">
              Confidence in the call
            </label>
            <div className="mt-2 flex items-center gap-3">
              <input
                id="confidence"
                type="range"
                min={1}
                max={5}
                step={1}
                value={draftConfidence}
                onChange={(event) => setDraftConfidence(Number(event.target.value))}
                className="h-2 w-full max-w-xs cursor-pointer appearance-none border border-rule bg-paper"
              />
              <output htmlFor="confidence" className="data w-8 text-sm font-bold">
                {draftConfidence}
              </output>
              <button
                type="button"
                onClick={() => void send({ confidence: draftConfidence }, "call")}
                disabled={busy !== null}
                className="border border-rule bg-paper px-3 py-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.1em] hover:border-ink disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="session-note" className="label">
              How did it feel?
            </label>
            <textarea
              id="session-note"
              value={draftNote}
              onChange={(event) => setDraftNote(event.target.value)}
              rows={3}
              maxLength={600}
              placeholder="fat and slow, couldn't hold an edge"
              className="mt-2 w-full border border-rule bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint"
            />
            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={() => void send({ note: draftNote }, "note")}
                disabled={busy !== null}
                className="inline-flex items-center gap-2 border-2 border-ink px-4 py-2 font-display text-sm font-bold text-ink hover:bg-ink hover:text-paper disabled:opacity-50"
              >
                {busy === "note" ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : null}
                Save note
              </button>
              <span className="font-mono text-[0.6875rem] text-ink-faint">{draftNote.length}/600</span>
            </div>
          </div>

          <div className="border-t border-rule pt-4">
            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="inline-flex items-center gap-2 border border-alert px-3 py-2 font-mono text-[0.6875rem] uppercase tracking-[0.1em] text-alert hover:bg-alert hover:text-paper"
              >
                <Trash2 size={14} aria-hidden="true" />
                Delete this session
              </button>
            ) : (
              <div className="border-l-4 border-alert bg-alert/10 px-4 py-3">
                <p className="text-sm text-alert">
                  Delete this session? The row is hidden and a tombstone is kept so the audit chain still replays, but
                  you cannot undo it from the UI.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void send(null, "delete")}
                    disabled={busy !== null}
                    className="inline-flex items-center gap-2 bg-alert px-4 py-2 font-display text-sm font-bold text-paper disabled:opacity-50"
                  >
                    {busy === "delete" ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : null}
                    Yes, delete it
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="border border-rule bg-paper px-4 py-2 font-display text-sm font-bold text-ink"
                  >
                    Keep it
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {error ? (
        <Notice tone="block">
          <p className="font-bold">Nothing was changed.</p>
          <p className="mt-1">{error}</p>
        </Notice>
      ) : null}
    </div>
  );
}