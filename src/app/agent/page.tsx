import Link from "next/link";
import { listBreaks } from "@/lib/live/breaks";
import { PROTOCOL_VERSION, TOOLS } from "@/lib/mcp/server";
import { site } from "@/config/site";
import { AgentConsole } from "@/components/AgentConsole";
import { Band, Crumbs, Notice, SectionHead } from "@/components/ui";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Agent console",
  description:
    "A live MCP JSON-RPC 2.0 endpoint with eight typed tools. Call it from this page and watch the exact request and response.",
};

export default function AgentPage() {
  const breaks = listBreaks();

  return (
    <>
      <div className="py-8">
        <Crumbs items={[{ href: "/", label: "Home" }, { label: "Agent console" }]} />
        <SectionHead
          eyebrow={`MCP · protocol ${PROTOCOL_VERSION}`}
          title="An agent can read the water and write a plan"
          lead={`POST JSON-RPC 2.0 to ${site.url}/api/mcp. Eight typed tools, five of them mutating, all going through the same service layer and the same audit chain as this website.`}
        />
      </div>

      <Band>
        <AgentConsole breaks={breaks.map((item) => ({ id: item.id, name: item.name }))} defaultBreakId={breaks[0].id} />
      </Band>

      <Band>
        <SectionHead eyebrow="Tool surface" title="What is actually exposed" />
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-ink text-left">
                <th className="label py-2 pr-4">Tool</th>
                <th className="label py-2 pr-4">Kind</th>
                <th className="label py-2">What it does</th>
              </tr>
            </thead>
            <tbody>
              {TOOLS.map((tool) => (
                <tr key={tool.name} className="border-b border-rule align-top">
                  <td className="py-2 pr-4 font-mono text-xs text-ink">{tool.name}</td>
                  <td className="py-2 pr-4">
                    <span
                      className={`px-2 py-0.5 font-mono text-[0.6875rem] uppercase tracking-[0.1em] ${
                        tool.annotations.readOnlyHint ? "bg-lagoon-wash text-lagoon-deep" : "bg-rescue/15 text-rescue"
                      }`}
                    >
                      {tool.annotations.readOnlyHint ? "read" : "mutating"}
                    </span>
                  </td>
                  <td className="py-2 text-ink-soft">{tool.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 font-mono text-xs text-ink-faint">
          A ready-made manifest is published at <Link href="/mcp.json" className="underline underline-offset-4">/mcp.json</Link>,
          pointing at the live endpoint.
        </p>
      </Band>

      <Band>
        <SectionHead eyebrow="Scope and safety" title="What an agent may do to your data" />
        <ul className="space-y-2 text-sm leading-relaxed text-ink-soft">
          <li>
            <strong className="text-ink">Owner scope:</strong> every tool acts on the anonymous HTTP-only cookie of the
            browser it was called from. An agent cannot read or delete another rider&apos;s sessions, because it has no
            way to name them.
          </li>
          <li>
            <strong className="text-ink">Idempotency:</strong> <code className="font-mono">create_session</code> accepts
            an <code className="font-mono">idempotencyKey</code>. Replaying the same key returns the original session
            instead of writing a second one.
          </li>
          <li>
            <strong className="text-ink">No invented data:</strong> a tool that cannot reach a live source reports the
            source as <code className="font-mono">fallback</code> and drops any factor it cannot compute.
          </li>
          <li>
            <strong className="text-ink">Rate limited:</strong> 120 JSON-RPC calls a minute per client, in memory, per
            serverless instance. That is a speed bump rather than a hard limit — see{" "}
            <Link href="/settings#security" className="underline underline-offset-4">
              settings
            </Link>
            .
          </li>
        </ul>
        <div className="mt-5">
          <Notice tone="info">
            Point any MCP client at <code className="font-mono">{site.url}/api/mcp</code>. The endpoint also answers GET
            with a discovery document listing every tool and a copy-pasteable example of each call.
          </Notice>
        </div>
      </Band>
    </>
  );
}