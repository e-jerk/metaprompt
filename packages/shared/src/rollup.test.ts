import { describe, expect, it } from "bun:test";
import { combineSummaries, emptyUsage } from "./rollup.js";
import type { Run } from "./types.js";

function run(partial: Partial<Run> & Pick<Run, "id" | "harness" | "status">): Run {
  return {
    owner: "alice",
    rootRunId: "root",
    depth: 1,
    partyId: "p",
    children: [],
    storage: "pvc",
    skills: [],
    mcpServers: [],
    assets: [],
    share: {},
    usage: emptyUsage("abc"),
    prefixHash: "abc",
    attempt: 1,
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

describe("summary rollup", () => {
  it("combines one hop in runId order without grandchild logs", () => {
    const rollup = combineSummaries(
      "parent",
      [
        run({ id: "run_b", harness: "stub", status: "succeeded", summary: "did B" }),
        run({ id: "run_a", harness: "stub", status: "succeeded", summary: "did A; grandchild folded" }),
      ],
      2048,
      8192,
    );
    expect(rollup.children.map((c) => c.runId)).toEqual(["run_a", "run_b"]);
    expect(rollup.combined).toContain("did A");
    expect(rollup.combined).toContain("did B");
    expect(rollup.combined).not.toContain("stdout");
  });
});
