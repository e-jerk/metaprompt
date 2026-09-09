import { describe, expect, it } from "bun:test";
import { readySpawnKeys, validateSpawnGraph } from "./spawn.js";

describe("spawn graph", () => {
  it("rejects cycles and unknown after ids", () => {
    expect(() =>
      validateSpawnGraph([
        { id: "a", harness: "stub", prompt: "a", after: ["b"] },
        { id: "b", harness: "stub", prompt: "b", after: ["a"] },
      ]),
    ).toThrow(/cycle/);
    expect(() =>
      validateSpawnGraph([{ id: "a", harness: "stub", prompt: "a", after: ["missing"] }]),
    ).toThrow(/unknown after/);
  });

  it("starts independents and unblocks after terminals", () => {
    const g = validateSpawnGraph([
      { id: "impl", harness: "stub", prompt: "i" },
      { id: "tests", harness: "stub", prompt: "t" },
      { id: "review", harness: "stub", prompt: "r", after: ["impl", "tests"] },
    ]);
    expect(readySpawnKeys(g, new Set()).sort()).toEqual(["impl", "tests"]);
    expect(readySpawnKeys(g, new Set(["impl"]))).toEqual(["impl", "tests"]);
    expect(readySpawnKeys(g, new Set(["impl", "tests"])).sort()).toEqual(["impl", "review", "tests"]);
  });
});
