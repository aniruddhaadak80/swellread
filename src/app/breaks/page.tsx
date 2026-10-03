import Link from "next/link";
import { listBreaks } from "@/lib/live/breaks";
import { TIDE_WINDOWS } from "@/lib/swell/engine";
import { Band, Crumbs, SectionHead } from "@/components/ui";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Breaks",
  description:
    "Every surf break in Swellread: coordinates, break type, peel orientation, reef slope, take-off depth, and whether a NOAA CO-OPS tide station is actually in range.",
};

export default function BreaksPage() {
  const breaks = listBreaks();
  const withTide = breaks.filter((item) => item.tideStationId !== null);

  return (
    <>
      <div className="py-10">
        <Crumbs items={[{ href: "/", label: "Home" }, { label: "Breaks" }]} />
        <SectionHead
          eyebrow="Catalogue"
          title="Fourteen real coastlines"
          lead="Coordinates and place names describe real breaks. Peel orientation, reef slope and take-off depth are this project's own editorial estimates, and a tide station is only listed where NOAA CO-OPS actually publishes predictions — so some of these can show you the swell but honestly cannot show you the tide."
        />
      </div>

      <Band>
        <ul className="grid gap-4 md:grid-cols-2">
          {breaks.map((item) => (
            <li key={item.id} className="border border-rule bg-paper">
              <div className="flex items-start justify-between gap-3 border-b border-rule px-4 py-3">
                <div>
                  <h3 className="font-display text-lg font-bold leading-tight">{item.name}</h3>
                  <p className="label mt-0.5">
                    {item.region}, {item.country}
                  </p>
                </div>
                <span className="shrink-0 border border-rule px-2 py-1 font-mono text-[0.6875rem] uppercase tracking-[0.1em] text-ink-soft">
                  {item.breakType.replace("_", " ")}
                </span>
              </div>

              <p className="px-4 py-3 text-sm leading-relaxed text-ink-soft">{item.blurb}</p>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-rule px-4 py-3 sm:grid-cols-4">
                <div>
                  <dt className="label">Peel from</dt>
                  <dd className="data mt-0.5 text-sm font-bold">{Math.round(item.orientationDeg)}°</dd>
                </div>
                <div>
                  <dt className="label">tanβ</dt>
                  <dd className="data mt-0.5 text-sm font-bold">{item.reefSlope.toFixed(2)}</dd>
                </div>
                <div>
                  <dt className="label">Take-off</dt>
                  <dd className="data mt-0.5 text-sm font-bold">{item.depthAtBreakM.toFixed(2)} m</dd>
                </div>
                <div>
                  <dt className="label">Local time</dt>
                  <dd className="data mt-0.5 text-sm font-bold">{item.timezone.split("/")[1]?.replace("_", " ")}</dd>
                </div>
              </dl>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-rule px-4 py-3">
                <span className="text-xs text-ink-faint">
                  Tide window:{" "}
                  <span className="data text-ink-soft">
                    {TIDE_WINDOWS[item.breakType].idealMin}–{TIDE_WINDOWS[item.breakType].idealMax} m
                  </span>{" "}
                  over the take-off
                </span>
                <span
                  className={`font-mono text-[0.6875rem] uppercase tracking-[0.1em] ${
                    item.tideStationId ? "text-lagoon-deep" : "text-rescue"
                  }`}
                >
                  {item.tideStationId
                    ? `NOAA ${item.tideStationId}${item.tideStationDistanceKm !== null ? ` · ${item.tideStationDistanceKm} km` : ""}`
                    : "no tide station in range"}
                </span>
              </div>

              <div className="border-t border-rule px-4 py-3">
                <Link
                  href={`/breaks/${item.id}`}
                  className="inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-[0.12em] text-rescue underline underline-offset-4"
                >
                  Open today&apos;s board
                </Link>
              </div>
            </li>
          ))}
        </ul>
      </Band>

      <Band>
        <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
          {withTide.length} of {breaks.length} breaks have a NOAA CO-OPS tide station in range, which is what lets the
          tide factor be scored at all. For the other {breaks.length - withTide.length}, Swellread drops the tide factor
          and renormalises the remaining weights instead of inventing a tide. You can see that happen on any of their
          pages.
        </p>
      </Band>
    </>
  );
}