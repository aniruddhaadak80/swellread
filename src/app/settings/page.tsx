import { currentOwnerId } from "@/lib/session/owner";
import { withDb } from "@/lib/db/client";
import { storeLabel } from "@/lib/db/store";
import { readSessions } from "@/lib/services/sessions";
import { site } from "@/config/site";
import { Band, Crumbs, Notice, SectionHead, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Settings and how this works",
  description:
    "Units, the bundled open-weights model, anonymous ownership, the production store, and the security model including what the rate limiter does and does not protect.",
};

export default async function SettingsPage() {
  const ownerId = await currentOwnerId();
  const sessions = await readSessions(ownerId, { limit: 100 });
  const resolution = await withDb(async (_executor, resolved) => resolved);

  return (
    <>
      <div className="py-8">
        <Crumbs items={[{ href: "/", label: "Home" }, { label: "Settings" }]} />
        <SectionHead
          eyebrow="Configuration and disclosure"
          title="What is set where, and what this app does not do"
        />
      </div>

      <Band>
        <SectionHead eyebrow="This browser" title="Your anonymous session" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Stat label="Owner id" value={<span className="break-all text-sm">{ownerId}</span>} hint="HTTP-only cookie, not a login" />
          <Stat label="Sessions stored" value={sessions.total} hint="scoped to that cookie" />
        </div>
        <div className="mt-4">
          <Notice tone="warn">
            There is no account system. Clearing cookies, using a private window, or switching browser loses access to
            your sessions — the rows stay in the database, but there is no longer a way to prove they are yours. That is
            a deliberate trade for a tool you open once before a drive, and it is why the exportable brief and its seal
            carry the real value.
          </Notice>
        </div>
      </Band>

      <Band id="units">
        <SectionHead eyebrow="Display" title="Units and formats" />
        <dl className="grid gap-4 sm:grid-cols-3">
          <Stat label="Swell height" value="metres" hint="as reported by Open-Meteo" />
          <Stat label="Tide" value="metres above MLLW" hint="NOAA CO-OPS station datum" />
          <Stat label="Wind" value="m/s" hint="10 m forecast" />
          <Stat label="Peel speed" value="km/h" hint="c = √(g·depth), converted" />
          <Stat label="Wave power" value="kW/m" hint="P = ⅟₁₆ρgHs²Tp" />
          <Stat label="Time" value="break local time" hint="IANA zone per break" />
        </dl>
        <p className="mt-4 text-xs leading-relaxed text-ink-faint">
          Units are fixed rather than configurable. A surf forecast with a units toggle is a forecast people misread on
          the way out of the door; every number here matches its source.
        </p>
      </Band>

      <Band id="model">
        <SectionHead eyebrow="Open-source AI" title="The model that ships in this repository" />
        <dl className="grid gap-4 sm:grid-cols-3">
          <Stat label="Model" value="all-MiniLM-L6-v2" hint="sentence embeddings" />
          <Stat label="Licence" value="Apache-2.0" hint="open weights" />
          <Stat label="Quantisation" value="int8" hint="20 MB on disk" />
        </dl>
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-ink-soft">
          The weights live at <code className="font-mono">/models/swellread-embed</code> in this repository and are
          loaded with <code className="font-mono">allowRemoteModels = false</code>, so no model host is contacted. It runs
          through ONNX Runtime in the tab: WebGPU where available, WASM otherwise. The first load also fetches the ~14 MB
          ONNX runtime from jsDelivr, after which the browser cache serves it and the model works with the network off.
        </p>
        <ul className="mt-4 space-y-2 text-sm leading-relaxed text-ink-soft">
          <li>
            <strong className="text-ink">What it does:</strong> reads the one-line note you write about a session,
            labels the kind of conditions you are describing, and finds your own earlier sessions with a similar vector.
          </li>
          <li>
            <strong className="text-ink">What never happens:</strong> the note is not sent anywhere, there is no API key,
            and there is no per-request cost. If the model fails to load, the panel says so and the rest of the app is
            unaffected.
          </li>
          <li>
            <strong className="text-ink">How to swap it:</strong> change the id passed to{" "}
            <code className="font-mono">pipeline()</code> and drop its files into{" "}
            <code className="font-mono">/public/models</code>. Nothing else assumes MiniLM.
          </li>
        </ul>
      </Band>

      <Band id="store">
        <SectionHead eyebrow="Persistence" title="Where your rows actually live" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Stat label="Adapter" value={storeLabel(resolution)} />
          <Stat
            label="Production store"
            value={resolution.kind === "neon" ? "hosted Postgres" : "embedded PGlite (not durable)"}
            hint={resolution.warning ?? "DATABASE_URL is set"}
          />
        </div>
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-ink-soft">
          Production refuses to start without <code className="font-mono">DATABASE_URL</code>. Selecting the embedded
          store in production is treated as a configuration error rather than a convenience, so a deploy can never
          silently lose writes on a cold start. Locally the app needs no environment variables at all.
        </p>
      </Band>

      <Band id="security">
        <SectionHead eyebrow="Security model" title="What is actually protected" />
        <ul className="space-y-3 text-sm leading-relaxed text-ink-soft">
          <li>
            <strong className="text-ink">Ownership:</strong> every read, update and delete is scoped by the owner id
            taken from an unguessable HTTP-only cookie. There is no path that returns another rider&apos;s row, and that
            is covered by tests rather than by inspection.
          </li>
          <li>
            <strong className="text-ink">Input:</strong> every body and query parameter is parsed with a schema before
            it reaches the service layer. Strings are length-capped, enum values are closed sets, ids are pattern-checked,
            and every SQL statement is parameterised — there is no string interpolation of user data into a query anywhere
            in the repository.
          </li>
          <li>
            <strong className="text-ink">Anonymous write abuse:</strong> in-memory sliding windows cap session creation
            at 20/min, updates at 40/min, rides at 30/min and deletes at 20/min per client, and JSON-RPC at 120/min.
            On a serverless platform each isolate keeps its own map, so this raises the cost of a hammering loop but is
            <em> not</em> a hard limit. A deployment that cares should put a platform WAF or a hosted limiter in front of
            the write routes.
          </li>
          <li>
            <strong className="text-ink">Upstreams:</strong> only two fixed hosts are contacted, both over HTTPS, both
            with a 9 second timeout and one retry. Responses are normalised and re-validated in TypeScript before use,
            and no upstream payload is rendered as HTML.
          </li>
          <li>
            <strong className="text-ink">Errors:</strong> API failures return a stable <code className="font-mono">{"{ error: { code, message } }"}</code>{" "}
            envelope. Stack traces, environment variables and driver messages are never sent to a client.
          </li>
          <li>
            <strong className="text-ink">Secrets:</strong> there are none. The app has no API keys, no tokens and no
            service credentials; the only environment variable in production is the database connection string.
          </li>
        </ul>
      </Band>

      <Band>
        <SectionHead eyebrow="Not implemented" title="Things this app does not do" />
        <ul className="space-y-2 text-sm leading-relaxed text-ink-soft">
          <li>No accounts, no email, no social login, no password reset.</li>
          <li>No push notifications or email. Nothing leaves the device except your own requests.</li>
          <li>No paid API keys and no third-party model provider, so no upstream can bill you or train on your notes.</li>
          <li>
            No multi-user sharing. A brief is shareable as a link, but sessions stay private to the browser that created
            them.
          </li>
        </ul>
        <p className="mt-4 font-mono text-xs text-ink-faint">engine {site.engineVersion}</p>
      </Band>
    </>
  );
}