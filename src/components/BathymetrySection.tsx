"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { BreakType, EngineResult } from "@/lib/types";
import { BAND_LABEL, BAND_STYLE, FactorBars, Notice } from "@/components/ui";

/**
 * The signature interaction: drag the tide, and the reef cross-section is re-cut,
 * the peel is re-solved, and the shared engine re-runs on the server.
 *
 * Nothing is computed in this file. It POSTs a what-if tide to /api/engine, which
 * calls exactly the same `scoreHour` the page, the REST routes and the MCP tools
 * use, and returns a sealed result.
 */

type Profile = Array<[number, number]>;

const PROFILES: Record<BreakType, { profile: Profile; takeOffX: number; label: string }> = {
  reef_pass: {
    label: "Reef pass — a channel cut through the outer barrier reef",
    takeOffX: 0.78,
    profile: [
      [0, 14],
      [0.3, 7.5],
      [0.55, 3.2],
      [0.72, 0.95],
      [0.78, 1.6],
      [0.845, 0.32],
      [0.92, 1.1],
      [1, 0.18],
    ],
  },
  reef: {
    label: "Fringing reef — the swell stands up on a shallow shelf",
    takeOffX: 0.72,
    profile: [
      [0, 11],
      [0.35, 5.5],
      [0.62, 2.1],
      [0.72, 0.85],
      [0.84, 0.45],
      [1, 0.12],
    ],
  },
  point: {
    label: "Point break — a cobble ledge that needs real swell and some water",
    takeOffX: 0.7,
    profile: [
      [0, 12],
      [0.4, 6],
      [0.7, 2.2],
      [0.8, 0.9],
      [1, 0.25],
    ],
  },
  beachbreak: {
    label: "Beachbreak — sand shifting under the take-off",
    takeOffX: 0.68,
    profile: [
      [0, 10],
      [0.4, 5],
      [0.68, 1.9],
      [0.85, 0.9],
      [1, 0.1],
    ],
  },
  river_mouth: {
    label: "River mouth — a sandbar with a channel through it",
    takeOffX: 0.74,
    profile: [
      [0, 9],
      [0.45, 4.2],
      [0.68, 2],
      [0.74, 1.5],
      [0.82, 0.7],
      [1, 0.15],
    ],
  },
};

const W = 720;
const H = 300;
const TOP = 24;
const FLOOR = 268;
const MAX_DEPTH = 15;

function depthAt(profile: Profile, x: number): number {
  if (x <= profile[0][0]) return profile[0][1];
  for (let i = 1; i < profile.length; i += 1) {
    const [x0, d0] = profile[i - 1];
    const [x1, d1] = profile[i];
    if (x <= x1) {
      const t = (x - x0) / Math.max(x1 - x0, 0.0001);
      return d0 + (d1 - d0) * t;
    }
  }
  return profile[profile.length - 1][1];
}

function xToPx(x: number): number {
  return x * W;
}

function depthToPx(depth: number): number {
  const clamped = Math.min(Math.max(depth, 0), MAX_DEPTH);
  return FLOOR - (clamped / MAX_DEPTH) * (FLOOR - TOP);
}

interface Props {
  breakId: string;
  breakName: string;
  breakType: BreakType;
  reefSlope: number;
  depthAtBreakM: number;
  hour: number;
  initialTide: number | null;
  initialEngine: EngineResult;
}

export function BathymetrySection(props: Props) {
  const { breakId, breakName, breakType, reefSlope, depthAtBreakM, hour, initialTide, initialEngine } = props;
  const config = PROFILES[breakType];

  const [tide, setTide] = useState<number>(initialTide ?? Math.max(0, depthAtBreakM * 0.7));
  const [engine, setEngine] = useState<EngineResult>(initialEngine);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controller = useRef<AbortController | null>(null);

  const runEngine = useCallback(
    async (tideM: number) => {
      controller.current?.abort();
      const next = new AbortController();
      controller.current = next;
      setPending(true);
      setError(null);
      try {
        const response = await fetch("/api/engine", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ breakId, hour, tideM: Number(tideM.toFixed(2)) }),
          signal: next.signal,
        });
        const body = (await response.json()) as {
          engine?: EngineResult;
          error?: { code: string; message: string };
        };
        if (!response.ok || !body.engine) {
          setError(body.error?.message ?? `The engine returned HTTP ${response.status}.`);
          return;
        }
        setEngine(body.engine);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "The engine could not be reached.");
      } finally {
        if (!next.signal.aborted) setPending(false);
      }
    },
    [breakId, hour],
  );

  useEffect(() => () => controller.current?.abort(), []);

  const onSlide = (value: number) => {
    setTide(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void runEngine(value);
    }, 220);
  };

  // Static geometry, recomputed only when the break changes.
  const geometry = useMemo(() => {
    const bed = config.profile.map(([x, depth]) => `${xToPx(x).toFixed(1)},${depthToPx(depth).toFixed(1)}`);
    const waterY = depthToPx(-tide);
    const bedPath = `M${xToPx(0).toFixed(1)},${depthToPx(0).toFixed(1)} L${bed.join(" L")} L${xToPx(1).toFixed(1)},${FLOOR}`;
    const takeOffDepth = depthAt(config.profile, config.takeOffX);
    const takeOffBedY = depthToPx(takeOffDepth);
    const waterDepth = tide - takeOffDepth;
    const showWater = waterDepth > 0;
    const waterPath = showWater
      ? `M${xToPx(0).toFixed(1)},${waterY.toFixed(1)} L${xToPx(config.takeOffX).toFixed(1)},${waterY.toFixed(1)} L${xToPx(config.takeOffX).toFixed(1)},${takeOffBedY.toFixed(1)} L${xToPx(1).toFixed(1)},${FLOOR} L${xToPx(0).toFixed(1)},${FLOOR} Z`
      : "";
    return { bedPath, waterY, takeOffX: xToPx(config.takeOffX), takeOffBedY, waterPath, showWater, waterDepth };
  }, [config, tide]);

  const breakHeight = engine.derived.breakHeightM ?? 0;
  const waveScale = Math.min(1.6, Math.max(0.35, breakHeight / 1.1));
  const waveTop = geometry.takeOffBedY - 62 * waveScale;
  const peelKmh = engine.derived.peelSpeedKmh ?? 0;
  const peelPx = Math.min(W * 0.42, 90 + peelKmh * 12);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <div className="border border-rule bg-paper">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule px-4 py-2">
          <span className="label">Seabed cross-section · {breakName}</span>
          <span className="text-xs text-ink-faint">{config.label}</span>
        </div>

        <div className="px-2 py-3">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full"
            role="img"
            aria-label={`Cross-section of ${breakName} with the water level set to ${tide.toFixed(2)} metres above chart datum, and ${geometry.waterDepth > 0 ? `${geometry.waterDepth.toFixed(2)}` : 'less than'} metres of water over the take-off.`}
          >
            <defs>
              <pattern id="section-grid" width="40" height="24" patternUnits="userSpaceOnUse">
                <path d="M40 0 H0 V24" fill="none" stroke="var(--color-rule)" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect x="0" y={TOP} width={W} height={FLOOR - TOP} fill="url(#section-grid)" />

            {/* seabed */}
            <path d={geometry.bedPath} fill="var(--color-glass-deep)" stroke="var(--color-ink)" strokeWidth={2} />

            {/* water body */}
            {geometry.showWater ? <path d={geometry.waterPath} fill="var(--color-lagoon)" opacity={0.34} /> : null}

            {/* water surface */}
            {geometry.showWater ? (
              <line x1="0" y1={geometry.waterY} x2={W} y2={geometry.waterY} stroke="var(--color-abyss)" strokeWidth={2} />
            ) : null}

            {/* the standing-up wave, with the peel running out of it */}
            {geometry.showWater ? (
              <g>
                <path
                  d={`M${(geometry.takeOffX - 78).toFixed(1)},${geometry.takeOffBedY.toFixed(1)} C ${(geometry.takeOffX - 40).toFixed(1)},${waveTop.toFixed(1)} ${(geometry.takeOffX - 6).toFixed(1)},${waveTop.toFixed(1)} ${geometry.takeOffX.toFixed(1)},${geometry.takeOffBedY.toFixed(1)}`}
                  fill="none"
                  stroke="var(--color-lagoon-deep)"
                  strokeWidth={3}
                  strokeLinecap="round"
                />
                <path
                  d={`M${geometry.takeOffX.toFixed(1)},${geometry.takeOffBedY.toFixed(1)} L${(geometry.takeOffX + peelPx).toFixed(1)},${geometry.takeOffBedY.toFixed(1)}`}
                  stroke="var(--color-rescue)"
                  strokeWidth={2.5}
                  strokeDasharray="10 6"
                />
                <path
                  d={`M${(geometry.takeOffX + peelPx).toFixed(1)},${geometry.takeOffBedY.toFixed(1)} l -12,-9 m 12,9 l -12,9`}
                  stroke="var(--color-rescue)"
                  strokeWidth={2.5}
                  fill="none"
                />
              </g>
            ) : null}

            {/* take-off marker */}
            <line x1={geometry.takeOffX} y1={geometry.takeOffBedY} x2={geometry.takeOffX} y2={TOP} stroke="var(--color-rescue)" strokeWidth={1} strokeDasharray="3 4" />
            <text x={geometry.takeOffX + 6} y={TOP + 12} fontSize={11} fill="var(--color-rescue)" fontFamily="var(--font-mono)">
              take-off
            </text>

            {/* depth axis */}
            {[0, 3, 6, 9, 12, 15].map((depth) => (
              <g key={depth}>
                <line x1="0" y1={depthToPx(depth)} x2={W} y2={depthToPx(depth)} stroke="var(--color-rule)" strokeWidth="0.75" />
                <text x="4" y={depthToPx(depth) - 3} fontSize={10} fill="var(--color-ink-faint)" fontFamily="var(--font-mono)">
                  {depth}m
                </text>
              </g>
            ))}

            <text x="6" y={FLOOR + 18} fontSize={11} fill="var(--color-ink-faint)" fontFamily="var(--font-mono)">
              offshore
            </text>
            <text x={W - 6} y={TOP - 8} fontSize={11} fill="var(--color-ink-faint)" textAnchor="end" fontFamily="var(--font-mono)">
              inshore · tanβ {reefSlope.toFixed(2)}
            </text>
          </svg>
        </div>

        <div className="border-t border-rule px-4 py-4">
          <label htmlFor="tide-drag" className="label">
            Drag the tide — what-if only, nothing stored is changed
          </label>
          <div className="mt-2 flex items-center gap-3">
            <input
              id="tide-drag"
              type="range"
              min={-0.5}
              max={3.5}
              step={0.05}
              value={tide}
              onChange={(event) => onSlide(Number(event.target.value))}
              className="h-2 flex-1 cursor-pointer appearance-none border border-rule bg-paper"
              aria-valuetext={`${tide.toFixed(2)} metres above chart datum`}
            />
            <output htmlFor="tide-drag" className="data w-20 shrink-0 text-right text-sm font-bold">
              {tide.toFixed(2)} m
            </output>
            {pending ? <Loader2 size={16} className="shrink-0 animate-spin text-rescue" aria-label="computing" /> : null}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-ink-soft">
            The dashed arrow is the peel, at c = √(g·depth). More water over the take-off means a faster peel,
            which is why the same swell behaves differently at low and mid tide.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="border border-rule bg-paper px-4 py-4">
          <p className="label">Re-solved by {engine.version}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-2 px-3 py-1.5 font-mono text-xs uppercase tracking-[0.12em] ${BAND_STYLE[engine.band]}`}>
              {BAND_LABEL[engine.band]} {(engine.score * 100).toFixed(0)}%
            </span>
            <span className="data text-xs text-ink-soft" data-testid="engine-seal">
              seal {engine.seal.slice(0, 12)}…
            </span>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <dt className="label">Water over take-off</dt>
              <dd className="data mt-0.5 text-lg font-bold">{geometry.waterDepth > 0 ? `${geometry.waterDepth.toFixed(2)} m` : "exposed"}</dd>
            </div>
            <div>
              <dt className="label">Break height</dt>
              <dd className="data mt-0.5 text-lg font-bold">{engine.derived.breakHeightM === null ? "—" : `${engine.derived.breakHeightM.toFixed(2)} m`}</dd>
            </div>
            <div>
              <dt className="label">Peel speed</dt>
              <dd data-testid="peel-speed-value" className="data mt-0.5 text-lg font-bold">
                {engine.derived.peelSpeedKmh === null ? "—" : `${engine.derived.peelSpeedKmh.toFixed(1)} km/h`}
              </dd>
            </div>
            <div>
              <dt className="label">Wave power</dt>
              <dd className="data mt-0.5 text-lg font-bold">{engine.derived.powerKwM === null ? "—" : `${engine.derived.powerKwM.toFixed(1)} kW/m`}</dd>
            </div>
          </dl>

          {error ? (
            <div className="mt-3">
              <Notice tone="block">
                <p className="font-bold">The what-if could not be computed.</p>
                <p className="mt-1">{error}</p>
              </Notice>
            </div>
          ) : null}

          <p className="mt-4 text-sm leading-relaxed text-ink">{engine.recommendation}</p>
        </div>

        <div className="border border-rule bg-paper px-4 py-4">
          <p className="label">Every factor, re-weighted for this tide</p>
          <div className="mt-3">
            <FactorBars factors={engine.factors} compact />
          </div>
        </div>
      </div>
    </div>
  );
}