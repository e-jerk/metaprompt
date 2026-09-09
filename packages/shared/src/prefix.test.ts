import { describe, expect, it } from "bun:test";
import { defaultHarnesses } from "./catalog.js";
import { cacheHintFor, computePrefixHash } from "./prefix.js";

describe("prefix hash", () => {
  const stub = defaultHarnesses().find((h) => h.name === "stub")!;

  it("is stable across identical catalog skill sets", () => {
    const a = computePrefixHash({
      harness: stub,
      skills: [{ name: "review" }],
      mcpServers: [{ name: "linear" }],
    });
    const b = computePrefixHash({
      harness: stub,
      skills: [{ name: "review" }],
      mcpServers: [{ name: "linear" }],
    });
    expect(a).toBe(b);
  });

  it("changes when inline skill is used and flags cacheHint", () => {
    const catalog = computePrefixHash({ harness: stub, skills: [{ name: "review" }], mcpServers: [] });
    const inline = computePrefixHash({
      harness: stub,
      skills: [{ name: "custom", content: "hello" }],
      mcpServers: [],
    });
    expect(catalog).not.toBe(inline);
    expect(cacheHintFor([{ name: "custom", content: "hello" }], [])).toBe("inline-skill");
  });

  it("does not include run ids", () => {
    const textHash = computePrefixHash({ harness: stub, skills: [], mcpServers: [] });
    expect(textHash).toMatch(/^[0-9a-f]{16}$/);
  });
});
