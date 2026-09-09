import { defaultConfig, identityFromStatic, type Identity } from "@metaprompt/shared";
import { describe, expect, it } from "bun:test";
import {
  assertNoSecretsInSpec,
  extraPodVolumes,
  jobManifest,
  parseAssetVolume,
  resolveAssetMounts,
  sessionPodManifest,
  specFromRun,
} from "./job-spec.js";
import { Plane } from "./plane.js";

function alice(plane: Plane): Identity {
  return identityFromStatic(plane.config.staticUsers[1]!);
}

describe("asset volume parse", () => {
  it("accepts pvc, hostPath, configMap, secret, and emptyDir", () => {
    expect(parseAssetVolume("pvc:eval-set-ro")).toEqual({ type: "pvc", name: "eval-set-ro" });
    expect(parseAssetVolume("hostPath:/var/lib/metaprompt/assets/eval-set")).toEqual({
      type: "hostPath",
      path: "/var/lib/metaprompt/assets/eval-set",
    });
    expect(parseAssetVolume("configMap:eval-set")).toEqual({ type: "configMap", name: "eval-set" });
    expect(parseAssetVolume("secret:eval-set")).toEqual({ type: "secret", name: "eval-set" });
    expect(parseAssetVolume("emptyDir")).toEqual({ type: "emptyDir" });
    expect(parseAssetVolume("emptyDir:Memory")).toEqual({ type: "emptyDir", medium: "Memory" });
  });

  it("rejects unknown volume kinds", () => {
    expect(() => parseAssetVolume("nfs:share")).toThrow(/unsupported asset volume/);
  });
});

describe("HarnessJob projection", () => {
  it("resolves catalog assets and never puts a run token on the spec", async () => {
    const plane = new Plane(defaultConfig({ bedrock: { enabled: false, region: "us-east-1" } }));
    const run = await plane.createRun(alice(plane), {
      harness: "stub",
      repo: "app",
      prompt: "hi",
      storage: "tmpfs",
      assets: ["eval-set"],
    });
    const spec = specFromRun(run, plane.config, { runToken: "secret-run-token", planeUrl: "http://plane" });
    expect(spec.assetMounts).toEqual([
      { name: "eval-set", volume: "pvc:eval-set-ro", mountPath: "/assets/eval-set", readOnly: true },
    ]);
    expect(spec.lowerdir).toBe("/repos/app/current");
    expect(spec.childMcpPort).toBe(3334);
    expect(spec.gitSync?.enabled).toBe(false);
    expect(JSON.stringify(spec)).not.toContain("secret-run-token");
    expect(() => assertNoSecretsInSpec(spec)).not.toThrow();
  });

  it("mounts git-sync hostPath and asset volumes on Jobs and sessions", async () => {
    const plane = new Plane(
      defaultConfig({
        bedrock: { enabled: false, region: "us-east-1" },
        gitSync: { enabled: true, hostPath: "/var/lib/metaprompt/repos" },
        assets: [
          {
            name: "eval-set",
            volume: "hostPath:/var/lib/metaprompt/assets/eval-set",
            mountPath: "/assets/eval-set",
            readers: ["public"],
          },
        ],
      }),
    );
    const run = await plane.createRun(alice(plane), {
      harness: "stub",
      repo: "app",
      prompt: "hi",
      storage: "tmpfs",
      assets: ["eval-set"],
    });
    const spec = specFromRun(run, plane.config);
    expect(spec.gitSync).toEqual({ enabled: true, hostPath: "/var/lib/metaprompt/repos" });
    const extra = extraPodVolumes(spec);
    expect(extra.volumes).toEqual(
      expect.arrayContaining([
        { name: "repos", hostPath: { path: "/var/lib/metaprompt/repos", type: "DirectoryOrCreate" } },
        {
          name: "asset-eval-set",
          hostPath: { path: "/var/lib/metaprompt/assets/eval-set", type: "DirectoryOrCreate" },
        },
      ]),
    );
    expect(extra.volumeMounts).toEqual(
      expect.arrayContaining([
        { name: "repos", mountPath: "/repos", readOnly: true },
        { name: "asset-eval-set", mountPath: "/assets/eval-set", readOnly: true },
      ]),
    );
    const job = jobManifest(spec);
    const session = sessionPodManifest(spec);
    expect(job.spec.template.spec.volumes).toEqual(expect.arrayContaining(extra.volumes));
    expect(session.spec.volumes).toEqual(expect.arrayContaining(extra.volumes));
    expect(job.spec.template.spec.containers[0].env).toEqual(
      expect.arrayContaining([
        { name: "METAPROMPT_LOWERDIR", value: "/repos/app/current" },
        { name: "METAPROMPT_CHILD_MCP_URL", value: "http://127.0.0.1:3334" },
        { name: "METAPROMPT_CHILD_MCP_PORT", value: "3334" },
      ]),
    );
  });

  it("skips unknown asset names when resolving mounts", () => {
    expect(resolveAssetMounts(["missing"], defaultConfig().assets)).toEqual([]);
  });
});
