# Security Policy

## Supported versions

Only the deployed `main` branch is supported. There are no long-lived release
branches.

## Reporting a vulnerability

Please do **not** open a public issue. Use GitHub's private reporting on the
[Security tab of this repository](https://github.com/aniruddhaadak80/swellread/security/advisories/new),
or email the maintainer. Include the route or MCP tool, the request you made, and
what you were able to reach. You can expect an acknowledgement within a few days.

## Threat model

Swellread has **no accounts, no authentication and no secrets**. The only
environment variable in production is a database connection string. That shapes the
whole design:

| Surface | Protection |
| --- | --- |
| Ownership | An unguessable id in an HTTP-only, same-site cookie, minted by middleware. Every read, update and delete is scoped to it. There is no code path that returns another rider's row. |
| Write abuse | In-memory sliding windows: 20 session creates/min, 40 updates/min, 30 rides/min, 20 deletes/min, 120 JSON-RPC calls/min, per client. On serverless each isolate keeps its own map, so this is a **speed bump, not a hard limit**. Put a platform WAF or hosted limiter in front of the write routes for a real guarantee. |
| Input | Every body and query parameter is parsed with a schema before reaching the service layer. Strings are length-capped, enums are closed sets, ids are pattern-checked, and every SQL statement is parameterised — there is no string interpolation of user input into SQL anywhere. |
| Upstreams | Exactly two fixed HTTPS hosts, a 9 s timeout and one retry. Payloads are normalised and re-validated in TypeScript; no upstream response is rendered as HTML. |
| Errors | A stable `{ "error": { "code", "message" } }` envelope. Stack traces, driver messages and environment variables are never returned to a client. |
| Integrity | Per-entity SHA-384 chains over canonical JSON. Deletes are soft so history stays replayable, which means a deleted row is still recoverable by the owner. |

## Known, accepted limitations

- **Anonymous ownership is cookie-scoped.** Clearing cookies loses access to your
  sessions. There is no recovery path by design, because there is no identity to
  recover to.
- **The rate limiter is per-instance.** On a multi-instance deployment N instances
  mean up to N× the configured rate.
- **Soft-deleted rows persist.** They are hidden from every read path but remain in
  the database to keep the audit chain replayable.
- **The bundled model is fetched as static files.** The weights are committed to
  the repository and loaded with `allowRemoteModels = false`; the ONNX Runtime WASM
  binary is fetched from jsDelivr on first use and then browser-cached. Nothing a
  user types is ever sent to either host.

## Surf safety, not security

This is a planning aid. It describes the surface of the ocean and cannot see the
reef, the current or your ability. It is not a safety guarantee, and the app says so
on every page that shows a verdict.