import type { HourPoint } from "@/lib/services/analysis";
import type { Band } from "@/lib/types";

/**
 * The tide ribbon: a 24-hour horizontal spine that appears on every working page.
 *
 * It is the layout signature of this product — a surf day is a timeline, so time
 * runs left to right and the page never stacks into a card grid. Each hour is a
 * real link, so the selected hour lives in the URL and survives a refresh or a
 * shared link.
 */

const W = 960;
const H = 132;
const PAD_L = 8;
const PAD_R = 8;
const BAR_TOP = 22;
const BAR_BOTTOM = 96;

function xFor(index: number, count: number): number {
  const usable = W - PAD_L - PAD_R;
  return PAD_L + (usable * index) / Math.max(1, count - 1);
}

function barColor(band: Band): string {
  switch (band) {
    case "get-in":
      return "var(--color-lagoon-deep)";
    case "worth-the-drive":
      return "var(--color-lagoon)";
    case "marginal":
      return "var(--color-abyss)";
    case "stay-home":
      return "var(--color-ink-faint)";
    default:
      return "var(--color-rescue-bright)";
  }
}

export function TideRibbon({
  points,
  activeIndex,
  currentIndex,
  hrefFor,
  title,
  caption,
}: {
  points: HourPoint[];
  activeIndex?: number | null;
  currentIndex?: number | null;
  hrefFor: (index: number) => string;
  title: string;
  caption?: string;
}) {
  if (points.length === 0) {
    return (
      <div className="border border-dashed border-rule bg-paper/60 p-6 text-sm text-ink-soft">
        No hourly data came back for this day, so there is no ribbon to draw.
      </div>
    );
  }

  const tideValues = points.map((point) => point.tideM).filter((value): value is number => value !== null);
  const swellValues = points.map((point) => point.swellHeightM).filter((value): value is number => value !== null);
  const tideMin = tideValues.length ? Math.min(...tideValues) : 0;
  const tideMax = tideValues.length ? Math.max(...tideValues) : 1;
  const swellMax = swellValues.length ? Math.max(...swellValues, 0.5) : 1;
  const tideSpan = Math.max(tideMax - tideMin, 0.4);

  const tideY = (value: number | null) => {
    if (value === null) return null;
    const t = (value - tideMin) / tideSpan;
    return BAR_TOP + 14 + (1 - t) * (BAR_BOTTOM - BAR_TOP - 30);
  };

  const tidePath = points
    .map((point, index) => {
      const y = tideY(point.tideM);
      return y === null ? null : `${index === 0 ? "M" : "L"}${xFor(index, points.length).toFixed(1)},${y.toFixed(1)}`;
    })
    .filter(Boolean)
    .join(" ");

  const swellPath = points
    .map((point, index) => {
      const value = point.swellHeightM;
      if (value === null) return null;
      const y = BAR_BOTTOM - 6 - (value / swellMax) * (BAR_BOTTOM - BAR_TOP - 18);
      return `${index === 0 ? "M" : "L"}${xFor(index, points.length).toFixed(1)},${y.toFixed(1)}`;
    })
    .filter(Boolean)
    .join(" ");

  return (
    <figure className="border border-rule bg-paper">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule px-4 py-2">
        <span className="label">{title}</span>
        {caption ? <span className="text-xs text-ink-faint">{caption}</span> : null}
      </figcaption>

      <div className="scroll-thin overflow-x-auto px-2 py-2">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-[132px] w-[960px] min-w-[720px]"
          role="img"
          aria-label={`${title}. ${points.length} hourly columns showing the engine score, with the tide curve and swell height overlaid.`}
        >
          {/* score columns */}
          {points.map((point, index) => {
            const x = xFor(index, points.length);
            const width = W / points.length / 1.9;
            const height = Math.max(2, (BAR_BOTTOM - BAR_TOP) * point.score);
            const isActive = activeIndex === index;
            const isNow = currentIndex === index;
            return (
              <g key={point.at}>
                <a href={hrefFor(index)} aria-label={`${point.localLabel} local time, score ${(point.score * 100).toFixed(0)} percent, band ${point.band}`}>
                  <rect x={x - width / 2} y={BAR_TOP} width={width} height={BAR_BOTTOM - BAR_TOP} fill="transparent" />
                  <rect
                    x={x - width / 2}
                    y={BAR_BOTTOM - height}
                    width={width}
                    height={height}
                    fill={barColor(point.band)}
                    opacity={point.gated ? 0.55 : 1}
                  />
                </a>
                {isActive ? (
                  <rect x={x - width / 2 - 1} y={BAR_TOP - 4} width={width + 2} height={BAR_BOTTOM - BAR_TOP + 4} fill="none" stroke="var(--color-rescue)" strokeWidth={2} />
                ) : null}
                {isNow ? (
                  <rect x={x - 1} y={BAR_TOP - 10} width={2} height={BAR_BOTTOM - BAR_TOP + 10} fill="var(--color-ink)" />
                ) : null}
                {index % 3 === 0 ? (
                  <text x={x} y={BAR_BOTTOM + 14} textAnchor="middle" fontSize={11} fill="var(--color-ink-faint)" fontFamily="var(--font-mono)">
                    {point.localLabel}
                  </text>
                ) : null}
              </g>
            );
          })}

          {/* swell height trace */}
          {swellPath ? <path d={swellPath} fill="none" stroke="var(--color-lagoon)" strokeWidth={1.5} opacity={0.85} /> : null}
          {/* tide curve */}
          {tidePath ? <path d={tidePath} fill="none" stroke="var(--color-abyss)" strokeWidth={2} strokeDasharray={tideValues.length === 0 ? "0" : "5 3"} /> : null}

          <line x1={PAD_L} y1={BAR_BOTTOM} x2={W - PAD_R} y2={BAR_BOTTOM} stroke="var(--color-ink)" strokeWidth={1.5} />
        </svg>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-rule px-4 py-2 font-mono text-[0.6875rem] text-ink-faint">
        <span>
          <span className="mr-1 inline-block h-2 w-2 bg-lagoon-deep align-middle" /> score
        </span>
        <span>
          <span className="mr-1 inline-block h-0.5 w-4 bg-abyss align-middle" /> tide (dashed, MLLW)
        </span>
        <span>
          <span className="mr-1 inline-block h-0.5 w-4 bg-lagoon align-middle" /> swell height
        </span>
        <span>
          <span className="mr-1 inline-block h-3 w-0.5 bg-ink align-middle" /> now
        </span>
        {tideValues.length === 0 ? <span className="text-rescue">no tide station in range</span> : null}
      </div>
    </figure>
  );
}