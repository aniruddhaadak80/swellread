import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson, GENESIS_SEAL, sealEvent, sha256Hex, verifyLink } from "@/lib/integrity/canonical";

describe("canonicalJson", () => {
  it("sorts object keys recursively", () => {
    expect(canonicalJson({ b: 1, a: { z: 1, y: 2 } })).toBe('{"a":{"y":2,"z":1},"b":1}');
  });

  it("preserves array order", () => {
    expect(canonicalJson({ list: [3, 1, 2] })).toBe('{"list":[3,1,2]}');
  });

  it("drops undefined members and normalises non-finite numbers", () => {
    expect(canonicalJson({ a: undefined, b: Number.NaN, c: Infinity })).toBe('{"b":null,"c":null}');
  });

  it("is insensitive to key insertion order", () => {
    const first: Record<string, unknown> = {};
    first.alpha = 1;
    first.beta = { delta: 4, gamma: 3 };
    const second: Record<string, unknown> = {};
    second.beta = { gamma: 3, delta: 4 };
    second.alpha = 1;
    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(sha256Hex(canonicalJson(first))).toBe(sha256Hex(canonicalJson(second)));
  });

  it("distinguishes genuinely different values", () => {
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
    expect(canonicalJson({ a: [1, 2] })).not.toBe(canonicalJson({ a: [2, 1] }));
  });
});

describe("sealEvent", () => {
  const event = {
    seq: 1,
    entityType: "session",
    entityId: "11111111-1111-4111-8111-111111111111",
    action: "session.create",
    createdAt: "2026-10-03T00:00:00.000Z",
    payload: { breakId: "pago-pago", score: 0.62 },
  };

  it("is SHA-384 over UTF-8(prevSeal) concatenated with UTF-8(canonicalJson(event))", () => {
    const expected = createHash("sha384")
      .update(Buffer.concat([Buffer.from(GENESIS_SEAL, "utf8"), Buffer.from(canonicalJson(event), "utf8")]))
      .digest("hex");
    expect(sealEvent(GENESIS_SEAL, event)).toBe(expected);
    expect(expected).toHaveLength(96);
  });

  it("produces a 96-hex-character digest for the genesis link", () => {
    expect(sealEvent(GENESIS_SEAL, event)).toMatch(/^[0-9a-f]{96}$/);
    expect(GENESIS_SEAL).toHaveLength(96);
    expect(GENESIS_SEAL).toMatch(/^0+$/);
  });

  it("changes when any field changes, including key order in the payload", () => {
    const base = sealEvent(GENESIS_SEAL, event);
    expect(sealEvent(GENESIS_SEAL, { ...event, seq: 2 })).not.toBe(base);
    expect(sealEvent(GENESIS_SEAL, { ...event, action: "session.update" })).not.toBe(base);
    expect(sealEvent(GENESIS_SEAL, { ...event, payload: { score: 0.62, breakId: "pago-pago" } })).toBe(base);
    expect(sealEvent(GENESIS_SEAL, { ...event, payload: { score: 0.63, breakId: "pago-pago" } })).not.toBe(base);
  });

  it("is deterministic across repeated calls", () => {
    expect(sealEvent(GENESIS_SEAL, event)).toBe(sealEvent(GENESIS_SEAL, event));
  });

  it("handles multi-byte characters through the same rule", () => {
    const unicode = { ...event, payload: { note: "peeling left 🏄 é" } };
    const expected = createHash("sha384")
      .update(Buffer.concat([Buffer.from(GENESIS_SEAL, "utf8"), Buffer.from(canonicalJson(unicode), "utf8")]))
      .digest("hex");
    expect(sealEvent(GENESIS_SEAL, unicode)).toBe(expected);
  });
});

describe("verifyLink", () => {
  const event = {
    seq: 1,
    entityType: "session",
    entityId: "abc",
    action: "session.create",
    createdAt: "2026-10-03T00:00:00.000Z",
    payload: { a: 1 },
  };

  it("accepts an untampered event once the seal is attached", () => {
    const sealed = { ...event, seal: sealEvent(GENESIS_SEAL, event) };
    expect(verifyLink(GENESIS_SEAL, sealed)).toBeNull();
  });

  it("rejects a mutated payload and names the sequence", () => {
    const sealed = { ...event, seal: sealEvent(GENESIS_SEAL, event) };
    const tampered = { ...sealed, payload: { a: 2 } };
    const problem = verifyLink(GENESIS_SEAL, tampered);
    expect(problem).toBeTruthy();
    expect(problem).toContain("seq 1");
  });

  it("rejects a seal attached to the wrong previous seal", () => {
    const sealed = { ...event, seal: sealEvent("f".repeat(96), event) };
    expect(verifyLink(GENESIS_SEAL, sealed)).toContain("seal mismatch");
  });

  it("rejects an event with no seal at all", () => {
    expect(verifyLink(GENESIS_SEAL, event)).toContain("seal mismatch");
  });
});