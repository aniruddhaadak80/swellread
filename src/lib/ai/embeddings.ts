"use client";

import { useCallback, useRef, useState } from "react";

/**
 * On-device sentence embeddings.
 *
 * The open-weights model (all-MiniLM-L6-v2, Apache-2.0, quantised to int8) is
 * committed to this repository at /public/models/swellread-embed. Nothing is ever
 * sent to a server: the note is tokenised and run through ONNX Runtime in this tab.
 * The ~14 MB WASM runtime is fetched once from jsDelivr on first use and is then
 * held in the browser cache, after which the model runs with the network off.
 */

export interface Embedder {
  embed: (text: string) => Promise<Float32Array>;
  backend: string;
}

type Progress = { status: string; progress: number; file?: string };

let cached: Embedder | null = null;

export async function loadEmbedder(onProgress?: (progress: Progress) => void): Promise<Embedder> {
  if (cached) return cached;

  const transformers = await import("@huggingface/transformers");
  const { env, pipeline } = transformers;

  // Open weights only. The model lives in this repo; remote model hosts are off.
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = "/models/";
  env.useBrowserCache = true;

  const extractor = (await pipeline("feature-extraction", "swellread-embed", {
    dtype: "q8",
    progress_callback: (event: unknown) => {
      const payload = event as { status?: string; progress?: number; file?: string };
      if (payload && typeof payload.status === "string") {
        onProgress?.({
          status: payload.status,
          progress: typeof payload.progress === "number" ? payload.progress / 100 : 0,
          file: payload.file,
        });
      }
    },
  })) as (text: string, options?: Record<string, unknown>) => Promise<{ data: Float32Array | number[]; dims: number[] }>;

  const embed = async (text: string): Promise<Float32Array> => {
    const output = await extractor(text, { pooling: "mean", normalize: true });
    return output.data instanceof Float32Array ? output.data : Float32Array.from(output.data);
  };

  const backend = typeof navigator !== "undefined" && "gpu" in navigator ? "webgpu if available, else wasm" : "wasm";

  cached = { embed, backend };
  return cached;
}

/** Cosine similarity. Both vectors are L2-normalised, so this is a dot product. */
export function cosine(a: Float32Array, b: Float32Array): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < length; i += 1) dot += a[i] * b[i];
  return Math.max(-1, Math.min(1, dot));
}

export function toBase64(vector: Float32Array): string {
  const bytes = new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function fromBase64(value: string): Float32Array | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Float32Array(bytes.buffer, 0, bytes.length / 4);
  } catch {
    return null;
  }
}

export function useEmbedder() {
  const [embedder, setEmbedder] = useState<Embedder | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (embedder || busy.current) return;
    busy.current = true;
    setError(null);
    try {
      const instance = await loadEmbedder(setProgress);
      setEmbedder(instance);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? `${caught.name}: ${caught.message}`
          : "The bundled model could not be loaded in this browser.",
      );
    } finally {
      busy.current = false;
    }
  }, [embedder]);

  return { embedder, progress, error, load };
}