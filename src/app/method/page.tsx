import Link from "next/link";
import { site } from "@/config/site";
import { ENGINE_VERSION, FACTOR_WEIGHTS, TIDE_WINDOWS, BREAKING_INDEX } from "@/lib/swell/engine";
import { GENESIS_SEAL } from "@/lib/integrity/canonical";
import { Band, Crumbs, SectionHead } from "@/components/ui";

export const metadata = {
  title: "Method",
  description:
    "Every formula, weight, gate and boundary case behind the swellread engine, written down so you can disagree with it.",
};

const FACTORS = [
  {
    key: "swellPower",
    label: "Swell power",
    body: "P = ⅟₁₆ · ρ · g · Hs² · Tp, with seawater density ρ = 1025 kg/m³. Score is P / 22, capped at 1. The 22 kW/m reference is a serious day: about 1.8 m at 11 s.",
  },
  {
    key: "peelSpeed",
    label: "Peel speed",
    body: "c = √(g · depth), depth being water over the take-off. Scored 1 between roughly 8.5 and 19 km/h, easing down on both sides — slower is mush, faster than about 25 km/h is unridable. This factor is dropped entirely when no tide value exists, because there is no depth to take the square root of.",
  },
  {
    key: "windQuality",
    label: "Wind quality",
    body: "Alignment = 1 − (1 + cos θ)/2, where θ is the angle between where the wind is from and where the swell is from: 1 when straight offshore, 0 when straight onshore. Multiplied by a speed envelope that peaks near 4 m/s and decays to 8% by 15.5 m/s.",
  },
  {
    key: "tideWindow",
    label: "Tide window",
    body: "Each break type has a band of water over the take-off where it works. The score ramps up from 55% of the minimum safe depth to the bottom of the band, holds at 1 through the band, and ramps back down to 0 at twice the top of the band.",
  },
  {
    key: "directionMatch",
    label: "Direction match",
    body: "1 − smoothstep(12°, 75°, Δ) where Δ is the angle between the swell bearing and the bearing the break peels cleanly from. Inside 12° is full marks; past 75° the swell has wrapped the headland.",
  },
  {
    key: "periodCleanliness",
    label: "Period cleanliness",
    body: "smoothstep(6 s, 9.5 s, Tp) with the score eased off by up to 35% beyond 14 s, because a very long swell stands up steeper than a shallow reef can hold.",
  },
];

export default function MethodPage() {
  return (
    <>
      <div className="py-8">
        <Crumbs items={[{ href: "/", label: "Home" }, { label: "Method" }]} />
        <SectionHead
          eyebrow={`${ENGINE_VERSION}`}
          title="Everything the engine does, written down"
          lead="One function, one set of weights, one code path shared by the pages, the REST API and the agent tools. If you disagree with a factor, you can change it here and the same change applies everywhere."
        />
      </div>

      <Band>
        <SectionHead eyebrow="Weights" title="Nominal weights, renormalised over what exists" />
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-ink text-left">
                <th className="label py-2 pr-4">Factor</th>
                <th className="label py-2 pr-4">Nominal weight</th>
                <th className="label py-2">Dropped when</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(FACTOR_WEIGHTS).map(([key, weight]) => (
                <tr key={key} className="border-b border-rule align-top">
                  <td className="py-2 pr-4 font-mono text-xs text-ink">
                    {FACTORS.find((factor) => factor.key === key)?.label ?? key}
                  </td>
                  <td className="data py-2 pr-4 text-ink">{weight.toFixed(2)}</td>
                  <td className="py-2 text-ink-soft">
                    {key === "peelSpeed" || key === "tideWindow"
                      ? "no verified tide value for this break"
                      : key === "swellPower" || key === "periodCleanliness"
                        ? "no swell height or period from the source"
                        : key === "windQuality"
                          ? "wind speed, wind bearing or swell bearing missing"
                          : "no swell bearing from the source"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-ink-soft">
          The nominal weights sum to exactly 1. When a factor has no real data behind it, its weight is removed and the
          rest are divided by what is left, so the score is always an average of comparable quantities rather than a
          quietly penalised score. A dropped factor shows as <em>not scored</em> in the interface, with the reason in
          its own words.
        </p>
      </Band>

      <Band>
        <SectionHead eyebrow="The six factors" title="What each one computes and why" />
        <ul className="space-y-4">
          {FACTORS.map((factor) => (
            <li key={factor.key} className="border-l-2 border-lagoon pl-4">
              <p className="font-display text-lg font-bold">
                {factor.label}{" "}
                <span className="data ml-1 text-xs font-normal text-ink-faint">
                  weight {FACTOR_WEIGHTS[factor.key as keyof typeof FACTOR_WEIGHTS].toFixed(2)}
                </span>
              </p>
              <p className="mt-1 text-sm leading-relaxed text-ink-soft">{factor.body}</p>
            </li>
          ))}
        </ul>
      </Band>

      <Band>
        <SectionHead eyebrow="Physics" title="The two formulas that carry most of the weight" />
        <div className="grid gap-5 md:grid-cols-2">
          <div className="border border-rule bg-paper p-5">
            <p className="label">Green&apos;s law on the reef face</p>
            <p className="data mt-3 text-lg">Hb = Hs₀ · (γ · tanβ)^¼</p>
            <p className="mt-3 text-sm leading-relaxed text-ink-soft">
              with γ = {BREAKING_INDEX}, the solitary-wave breaking index. The result is the height at which the swell
              trips on the face. It is then capped by the water you actually have, Hb = min(Hb, γ·depth), because a wave
              in water shallower than Hb/γ has already broken further out and is closing rather than standing up.
            </p>
          </div>
          <div className="border border-rule bg-paper p-5">
            <p className="label">Shallow-water celerity</p>
            <p className="data mt-3 text-lg">c = √(g · depth)</p>
            <p className="mt-3 text-sm leading-relaxed text-ink-soft">
              This is why tide matters more than most forecasts admit. The same 1.2 m swell over a 0.6 m take-off peels
              at about 10 km/h and is unridable; over 2 m it peels at 19 km/h and is the best thing on the coast. The
              drag control on every break page exists to make that relationship visible.
            </p>
          </div>
        </div>
      </Band>

      <Band>
        <SectionHead eyebrow="Gates" title="The hard rules that override the weighted sum" />
        <ul className="space-y-3 text-sm leading-relaxed text-ink-soft">
          <li>
            <strong className="text-ink">flat (blocking):</strong> a swell below 0.35 m scores zero. There is nothing
            to break on, and a low number would be more honest than a low score.
          </li>
          <li>
            <strong className="text-ink">reef-exposed (blocking):</strong> when water over the take-off falls below the
            break type&apos;s minimum safe depth, the score is clamped to at most 0.08. This is a hazard, not a score.
          </li>
          <li>
            <strong className="text-ink">blown-out (×0.55):</strong> wind above 13.5 m/s.
          </li>
          <li>
            <strong className="text-ink">exposed (×0.7):</strong> a swell above 2.6 m, which is big enough to hold you
            under on a bad take-off.
          </li>
          <li>
            <strong className="text-ink">covering-fast (informational):</strong> a flooding tide above 0.7 m/h while the
            take-off is still shallow, which usually means it will keep standing up as you sit out there.
          </li>
        </ul>

        <p className="label mt-8">Tide windows by break type</p>
        <div className="scroll-thin mt-2 overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-ink text-left">
                <th className="label py-2 pr-4">Break type</th>
                <th className="label py-2 pr-4">Ideal band</th>
                <th className="label py-2 pr-4">Minimum safe</th>
                <th className="label py-2">Reads</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(TIDE_WINDOWS).map(([type, spec]) => (
                <tr key={type} className="border-b border-rule align-top">
                  <td className="py-2 pr-4 font-mono text-xs text-ink">{type.replace("_", " ")}</td>
                  <td className="data py-2 pr-4 text-ink">
                    {spec.idealMin}–{spec.idealMax} m
                  </td>
                  <td className="data py-2 pr-4 text-ink">{spec.minSafe.toFixed(2)} m</td>
                  <td className="py-2 text-ink-soft">{spec.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Band>

      <Band>
        <SectionHead eyebrow="Bands" title="Score to verdict" />
        <ul className="space-y-1.5 text-sm text-ink-soft">
          <li>
            <span className="data text-ink">≥ 0.70</span> — Get in the water
          </li>
          <li>
            <span className="data text-ink">≥ 0.50</span> — Worth the drive
          </li>
          <li>
            <span className="data text-ink">≥ 0.30</span> — Marginal, one good hour at most
          </li>
          <li>
            <span className="data text-ink">&lt; 0.30</span> — Stay home
          </li>
          <li>
            <span className="data text-ink">0</span> — Nothing to surf
          </li>
        </ul>
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-ink-soft">
          The day&apos;s window is the longest contiguous run of hours at or above 0.50, ties broken on mean score. If
          nothing clears 0.50 the app still returns the single best hour rather than shrugging.
        </p>
      </Band>

      <Band>
        <SectionHead eyebrow="Integrity" title="How the chain is built" />
        <div className="border border-rule bg-paper p-5">
          <p className="data text-sm">seal_n = SHA-384( UTF-8(prevSeal) || canonicalJson(event_n) )</p>
          <p className="data mt-2 text-sm text-ink-soft">genesis prevSeal = {"0".repeat(96)}</p>
          <p className="mt-4 text-sm leading-relaxed text-ink-soft">
            Canonical JSON sorts object keys recursively by UTF-16 code unit, preserves array order, drops{" "}
            <code className="font-mono">undefined</code> and normalises non-finite numbers.{" "}
            <code className="font-mono">seal</code> and <code className="font-mono">prevSeal</code> are stored beside
            the event, never inside it, so the body that gets hashed is exactly the body in the table.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">
            Deleting a session is a soft delete that keeps a tombstone, so the chain stays replayable forever. The{" "}
            <Link href="/verify" className="underline underline-offset-4">
              replay tool
            </Link>{" "}
            recomputes every link and names the first broken one.
          </p>
          <p className="mt-3 font-mono text-xs text-ink-faint">genesis = {GENESIS_SEAL.slice(0, 24)}…</p>
        </div>
      </Band>

      <Band>
        <SectionHead eyebrow="Data" title="Sources, and what happens when they fail" />
        <div className="grid gap-4 md:grid-cols-3">
          <div className="border border-rule bg-paper p-4">
            <p className="label">NOAA CO-OPS</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              Hourly tide <code className="font-mono">predictions</code>, MLLW datum, keyless. The observed{" "}
              <code className="font-mono">water_level</code> product is deliberately not used for forecasts because it
              stops at &quot;now&quot;.
            </p>
          </div>
          <div className="border border-rule bg-paper p-4">
            <p className="label">Open-Meteo</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              Marine for swell height, period and bearing; Forecast for wind, air temperature, cloud and rain. Both
              keyless, both CC BY 4.0.
            </p>
          </div>
          <div className="border border-rule bg-paper p-4">
            <p className="label">Failure</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              If every upstream fails, a sealed dated synthetic profile is shown and labelled{" "}
              <code className="font-mono">fallback</code>. It never replaces anything a user created, and it never
              invents a tide for a break with no station.
            </p>
          </div>
        </div>
        <p className="mt-4 font-mono text-xs text-ink-faint">
          Break coordinates describe real coastlines. Peel orientation, reef slope and take-off depth are this
          project&apos;s editorial estimates and are labelled as such wherever they appear. Repository {site.repository}.
        </p>
      </Band>
    </>
  );
}