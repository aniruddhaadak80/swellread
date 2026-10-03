import { fetchJson } from "@/lib/live/http";
import { num } from "@/lib/swell/math";
import type { SourceMeta, TideSeries } from "@/lib/types";
import { summarizeTide } from "@/lib/swell/tides";

/**
 * NOAA CO-OPS tide predictions. Public, keyless, no registration.
 *
 * `product=predictions` is the forecast product and reaches days into the
 * future; `product=water_level` is the verified observed product and stops at
 * "now", which is why the app never uses it for a forecast.
 *
 * The two products do NOT share a response shape: the observed one returns
 * `{ metadata, data: [...] }` while the forecast one returns
 * `{ predictions: [...] }`. `normaliseTideRows` accepts both so the parser cannot
 * silently come back empty when the upstream shape changes.
 */

export const NOAA_TIDE_ATTRIBUTION = {
  id: "noaa-coops" as const,
  name: "NOAA CO-OPS tide predictions",
  url: "https://tidesandcurrents.noaa.gov/",
  license: "U.S. Government public domain",
};

export interface NoaaPayload {
  metadata?: { id?: string; name?: string; lat?: string; lon?: string };
  data?: Array<{ t?: string; v?: string; s?: string; q?: string }>;
  predictions?: Array<{ t?: string; v?: string; s?: string; q?: string }>;
  error?: { message?: string };
}

interface TideRow {
  t: string;
  m: number;
}

/** "2026-10-03 07:00" as an explicit UTC instant. */
function noaaTimeToIso(value: string): string {
  return `${value.replace(" ", "T")}:00Z`;
}

/** Pulls rows out of either NOAA response shape. */
export function normaliseTideRows(payload: unknown): { rows: TideRow[]; name: string | null } {
  const data = payload as NoaaPayload | null;
  if (!data) return { rows: [], name: null };
  const list = Array.isArray(data.predictions) ? data.predictions : Array.isArray(data.data) ? data.data : [];
  const rows: TideRow[] = [];
  for (const row of list) {
    if (!row || typeof row.t !== "string") continue;
    const value = num(row.v);
    if (value === null) continue;
    const ms = Date.parse(noaaTimeToIso(row.t));
    if (!Number.isFinite(ms)) continue;
    rows.push({ t: new Date(ms).toISOString(), m: value });
  }
  rows.sort((a, b) => a.t.localeCompare(b.t));
  return { rows, name: typeof data.metadata?.name === "string" ? data.metadata.name : null };
}

function compactDate(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, "");
}

export interface TideFetch {
  series: TideSeries;
  source: SourceMeta;
}

export async function fetchTidePrediction(
  stationId: string,
  stationName: string,
  startIso: string,
  days = 5,
): Promise<TideFetch> {
  const end = new Date(Date.parse(startIso) + days * 86_400_000);
  const url =
    "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter" +
    `?product=predictions&application=swellread` +
    `&begin_date=${compactDate(startIso)}&end_date=${compactDate(end.toISOString())}` +
    `&datum=MLLW&station=${encodeURIComponent(stationId)}` +
    `&time_zone=gmt&units=metric&format=json&interval=h`;

  const result = await fetchJson<NoaaPayload>(url);
  const fetchedAt = result.ok ? result.fetchedAt : new Date().toISOString();

  const empty = (note: string, stale: boolean): TideFetch => ({
    series: summarizeTide({
      stationId,
      stationName,
      datum: "MLLW",
      points: [],
      status: "fallback",
      note,
    }),
    source: {
      ...NOAA_TIDE_ATTRIBUTION,
      status: "fallback",
      fetchedAt,
      stale,
      note,
    },
  });

  if (!result.ok) {
    return empty(
      `NOAA CO-OPS did not answer (${result.reason}). No tide value has been invented.`,
      true,
    );
  }
  if (result.data.error?.message) {
    return empty(
      `NOAA CO-OPS has no predictions for this station in that window (${result.data.error.message}). The tide factor is dropped, not guessed.`,
      true,
    );
  }

  const { rows, name } = normaliseTideRows(result.data);
  if (rows.length === 0) {
    return empty(
      "NOAA CO-OPS returned a response with no usable predictions for this station in that window. The tide factor is dropped, not guessed.",
      true,
    );
  }

  const resolvedName = name ?? stationName;
  return {
    series: summarizeTide({
      stationId,
      stationName: resolvedName,
      datum: "MLLW",
      points: rows,
      status: "live",
    }),
    source: {
      ...NOAA_TIDE_ATTRIBUTION,
      status: "live",
      fetchedAt,
      stale: false,
      note: `${rows.length} hourly predictions, MLLW datum, station ${stationId} (${resolvedName}).`,
    },
  };
}