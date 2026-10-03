"use client";

import { useEffect, useMemo, useState } from "react";
import { Cpu, Loader2, Save } from "lucide-react";
import { cosine, fromBase64, toBase64, useEmbedder } from "@/lib/ai/embeddings";
import { Notice } from "@/components/ui";

/**
 * "Find the sessions that felt like this one."
 *
 * The open-weights sentence encoder runs in this tab, so the note never leaves
 * the device. The resulting vector is stored with the session (base64 int8-
 * quantised floats) and compared against the vectors of the rider's own past
 * sessions. When the model is unavailable, the panel says so and the rest of the
 * app carries on unchanged.
 */

const ANCHORS: Array<{ label: string; phrases: string[] }> = [
  { label: "clean and hollow", phrases: ["clean and hollow with long lines and no wind on it", "glassy and lined up, easy takeoff"] },
  { label: "polished and fast", phrases: ["polished and so fast it never stood up", "too fast, no place to sit"] },
  { label: "fat and slow", phrases: ["fat and slow, mushy, could not get down the line", "no shape, just a big blob"] },
  { label: "bumpy and walled", phrases: ["bumpy and walled in with no shape at all", "chop on top of chop"] },
  { label: "blown out", phrases: ["blown out by onshore wind with nowhere to hide", "onshore junk all morning"] },
  { label: "shallow and closing", phrases: ["shallow, the reef is showing, everything closes out", "too shallow, rocks hurt"] },
];

interface PastSession {
  id: string;
  label: string;
  when: string;
  conditions: string;
  embedding: string | null;
}

interface Props {
  sessionId: string;
  note: string;
  savedEmbedding: string | null;
  past: PastSession[];
}

export function FeelMatch({ sessionId, note, savedEmbedding, past }: Props) {
  const { embedder, progress, error, load } = useEmbedder();
  const [analysis, setAnalysis] = useState<{
    label: string;
    scores: Array<{ label: string; score: number }>;
    similar: Array<{ id: string; label: string; when: string; conditions: string; score: number }>;
    stored: boolean;
  } | null>(null);
  const [running, setRunning] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const comparable = useMemo(() => past.filter((entry) => entry.embedding !== null), [past]);

  useEffect(() => {
    if (!embedder) return;
    let cancelled = false;
    const text = note.trim();
    if (text.length < 8) return;

    setRunning(true);
    void (async () => {
      try {
        const noteVector = await embedder.embed(text);
        const anchorVectors = await Promise.all(
          ANCHORS.map(async (anchor) => {
            const vectors = await Promise.all(anchor.phrases.map((phrase) => embedder.embed(phrase)));
            const mean = new Float32Array(vectors[0].length);
            for (const vector of vectors) for (let i = 0; i < mean.length; i += 1) mean[i] += vector[i] / vectors.length;
            let norm = 0;
            for (const value of mean) norm += value * value;
            norm = Math.sqrt(norm) || 1;
            for (let i = 0; i < mean.length; i += 1) mean[i] /= norm;
            return { label: anchor.label, score: cosine(noteVector, mean) };
          }),
        );
        const scores = anchorVectors.sort((a, b) => b.score - a.score);
        const similar = comparable
          .map((entry) => {
            const vector = fromBase64(entry.embedding as string);
            return vector ? { ...entry, score: cosine(noteVector, vector) } : null;
          })
          .filter((entry): entry is typeof entry & { score: number } => entry !== null)
          .sort((a, b) => b.score - a.score)
          .slice(0, 3);
        if (!cancelled) {
          setAnalysis({ label: scores[0]?.label ?? "unclassified", scores: scores.slice(0, 3), similar, stored: false });
        }
      } catch (caught) {
        if (!cancelled) setSaveError(caught instanceof Error ? caught.message : "The model failed on this text.");
      } finally {
        if (!cancelled) setRunning(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [embedder, note, comparable]);

  async function store() {
    if (!embedder) return;
    const text = note.trim();
    if (text.length < 8) return;
    setSaveState("saving");
    setSaveError(null);
    try {
      const vector = await embedder.embed(text);
      const response = await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ embedding: toBase64(vector) }),
      });
      const body = (await response.json()) as { error?: { message: string } };
      if (!response.ok) {
        setSaveError(body.error?.message ?? `Saving failed with HTTP ${response.status}.`);
        setSaveState("error");
        return;
      }
      setSaveState("saved");
      setAnalysis((current) => (current ? { ...current, stored: true } : current));
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "The vector could not be saved.");
      setSaveState("error");
    }
  }

  return (
    <div className="border border-rule bg-paper">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule px-4 py-3">
        <span className="label">Feel match · open-weights model, in this browser only</span>
        <span className="font-mono text-[0.6875rem] text-ink-faint">all-MiniLM-L6-v2 · int8 · from this repo</span>
      </div>

      <div className="space-y-4 px-4 py-4">
        {!embedder ? (
          <>
            <p className="text-sm leading-relaxed text-ink-soft">
              Write one line about how the water felt. An open-weights sentence encoder committed to this repository
              will read it here in your browser, label the kind of session you are describing, and find your own past
              sessions that felt the same. Nothing is sent anywhere.
            </p>
            {progress ? (
              <div>
                <div className="h-2 w-full bg-glass-deep">
                  <div className="h-2 bg-lagoon-deep transition-all" style={{ width: `${Math.round(progress.progress * 100)}%` }} />
                </div>
                <p className="mt-1 font-mono text-[0.6875rem] text-ink-faint">
                  {progress.status}
                  {progress.file ? ` · ${progress.file}` : ""} · {Math.round(progress.progress * 100)}%
                </p>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-2 border-2 border-ink px-4 py-2 font-display text-sm font-bold text-ink hover:bg-ink hover:text-paper"
            >
              <Cpu size={16} aria-hidden="true" />
              Load the local model
            </button>
            <p className="text-xs text-ink-faint">
              First load pulls the model from this site and the ~14 MB ONNX runtime from jsDelivr, then the browser
              caches both. After that it runs with the network off.
            </p>
          </>
        ) : null}

        {error ? (
          <Notice tone="warn">
            <p className="font-bold">The bundled model did not load in this browser.</p>
            <p className="mt-1">{error}</p>
            <p className="mt-1">
              Nothing else in Swellread depends on it. The deterministic engine, the tide maths, the REST API and the
              agent tools all run without it.
            </p>
          </Notice>
        ) : null}

        {embedder && running ? (
          <p className="flex items-center gap-2 font-mono text-xs text-ink-soft">
            <Loader2 size={14} className="animate-spin" aria-hidden="true" /> embedding on {embedder.backend}
          </p>
        ) : null}

        {embedder && analysis ? (
          <>
            <div>
              <p className="label">This reads as</p>
              <p className="display mt-1 text-3xl">{analysis.label}</p>
            </div>

            <ul className="space-y-1.5">
              {analysis.scores.map((entry) => (
                <li key={entry.label}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-mono text-xs uppercase tracking-[0.1em] text-ink">{entry.label}</span>
                    <span className="data text-xs text-ink-faint">cos {entry.score.toFixed(3)}</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full bg-glass-deep">
                    <div
                      className="h-1.5 bg-abyss"
                      style={{ width: `${Math.max(1, Math.min(100, ((entry.score + 1) / 2) * 100))}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>

            <div>
              <p className="label">Your own sessions that read the same</p>
              {analysis.similar.length === 0 ? (
                <p className="mt-1 text-sm text-ink-soft">
                  No earlier session has a stored vector yet. Save this one, then the next time you write a note the
                  search has something to compare against.
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {analysis.similar.map((entry) => (
                    <li key={entry.id} className="border-l-2 border-lagoon pl-3">
                      <p className="font-display text-sm font-bold">
                        {entry.label} <span className="data ml-1 text-xs font-normal text-ink-faint">cos {entry.score.toFixed(3)}</span>
                      </p>
                      <p className="text-xs text-ink-soft">
                        {entry.when} · {entry.conditions}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {note.trim().length >= 8 ? (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void store()}
                  disabled={saveState === "saving" || saveState === "saved"}
                  className="inline-flex items-center gap-2 border-2 border-ink px-4 py-2 font-display text-sm font-bold text-ink hover:bg-ink hover:text-paper disabled:opacity-50"
                >
                  {saveState === "saving" ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
                  {saveState === "saved" ? "Vector stored" : saveState === "saving" ? "Storing…" : "Store this vector"}
                </button>
                <span className="font-mono text-[0.6875rem] text-ink-faint">
                  {savedEmbedding ? "a vector is already stored for this session; saving replaces it" : "no vector stored yet"} ·{" "}
                  {analysis.stored ? "just written" : "not yet written"}
                </span>
              </div>
            ) : (
              <p className="text-sm text-ink-soft">Add a note of at least eight characters first — the engine needs something to read.</p>
            )}

            {saveError ? (
              <Notice tone="block">
                <p className="font-bold">The vector was not stored.</p>
                <p className="mt-1">{saveError}</p>
              </Notice>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}