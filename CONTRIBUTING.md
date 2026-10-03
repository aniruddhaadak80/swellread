# Contributing to Swellread

Thanks for considering it. This is a small project with a narrow thesis: **never
invent a number, and always show the arithmetic**. Most contributions that fit well
are ones that make that easier to keep true.

## Getting running in under a minute

```bash
git clone https://github.com/aniruddhaadak80/swellread
cd swellread
npm ci
npm run dev
```

There is nothing to configure. With no environment variables the app runs on an
embedded PGlite database, seeds its break catalogue on first run, and talks to the
real NOAA and Open-Meteo APIs. See `.env.example` if you want to point it at a
hosted Postgres instead.

Before you open a pull request:

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest, deterministic
npm run build       # next build
```

All four must pass. Fix the implementation rather than suppressing a rule — that
is the same standard the project holds itself to.

## What makes a good pull request here

- **A factor or weight change** must come with the physics or the evidence, a note
  in `src/app/method/page.tsx`, and unit tests for the normal, boundary and empty
  cases. `src/lib/swell/engine.ts` is the only place that arithmetic lives.
- **A new data source** must be added in `src/lib/live/`, normalised into
  `src/lib/types.ts`, carry attribution and a licence, have a bounded timeout and a
  bounded retry, and report `status: "fallback"` when it fails. The sealed offline
  sample in `fallback.ts` must never be presented as live.
- **A new break** goes in `src/lib/live/breaks.ts`. Only give it a `tideStationId`
  if NOAA CO-OPS genuinely publishes predictions for that station — otherwise the
  tide factor is dropped and the weights renormalised, which is a feature.
- **A new agent tool** must go through the service layer in
  `src/lib/services/`, be owner-scoped, support idempotency where it mutates, and
  add the same tool to `public/mcp.json`.
- **Anything that writes** must append an audit event inside the same SQL statement
  that changes the row, and the change must be covered by a repository test.

## Things we will push back on

- A control that cannot work without a key we do not ship.
- An advanced feature that exists to look impressive rather than to solve the
  problem.
- Copy that calls fallback data "live", or a score without the arithmetic behind it.
- Calculations duplicated in a component. If it is a number a visitor sees, it
  comes from `scoreHour`, and `scoreHour` is on the server.

## Reporting bugs

Open an issue with the route or tool, what you expected, what happened, and whether
you were on the embedded store or a hosted one. For anything security-sensitive
please follow `SECURITY.md` instead of opening a public issue.

## Licence

MIT. See [LICENSE](LICENSE).