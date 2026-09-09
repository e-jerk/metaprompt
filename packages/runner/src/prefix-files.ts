import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ALWAYS_ON_MCPS,
  ALWAYS_ON_SCHEMAS,
  catalogMcpNames,
  catalogSkillNames,
  computePrefixHash,
  stablePrefixText,
  type HarnessAdapter,
  type McpRef,
  type SkillRef,
} from "@metaprompt/shared";

export async function materializePrefix(input: {
  cwd: string;
  harness: HarnessAdapter;
  skills: SkillRef[];
  mcpServers: McpRef[];
  planeUrl: string;
  childMcpUrl: string;
  extraSkillContents?: Record<string, string>;
  planeToken?: string;
  alwaysOnViaPlane?: boolean;
}): Promise<{ prefixHash: string; files: string[] }> {
  const files: string[] = [];
  const prefix = stablePrefixText(input);
  const prefixHash = computePrefixHash(input);
  const skillDir = join(input.cwd, "skills");
  await mkdir(skillDir, { recursive: true });
  for (const dir of input.harness.skillPaths) {
    await mkdir(join(input.cwd, dir), { recursive: true });
  }
  for (const skill of input.skills) {
    const content = skill.content ?? input.extraSkillContents?.[skill.name] ?? `# ${skill.name}\n`;
    const dest = join(skillDir, skill.name, "SKILL.md");
    await mkdir(join(skillDir, skill.name), { recursive: true });
    await writeFile(dest, content);
    files.push(dest);
    for (const pointer of [".cursor/skills", ".grok/skills"]) {
      const p = join(input.cwd, pointer, skill.name, "SKILL.md");
      await mkdir(join(input.cwd, pointer, skill.name), { recursive: true });
      await writeFile(p, content);
      files.push(p);
    }
  }
  const planeEndpoint = input.planeUrl.replace(/\/$/, "").endsWith("/mcp")
    ? input.planeUrl
    : `${input.planeUrl.replace(/\/$/, "")}/mcp`;
  const headers = input.planeToken ? { Authorization: `Bearer ${input.planeToken}` } : undefined;
  const planeServer = headers ? { url: planeEndpoint, headers } : { url: planeEndpoint };
  const childBase = input.childMcpUrl.replace(/\/$/, "");
  const childMcp = childBase.endsWith("/mcp") ? childBase : `${childBase}/mcp`;
  const childJj = childBase.endsWith("/jj") ? childBase : `${childBase.replace(/\/mcp$/, "")}/jj`;
  const alwaysOn = input.alwaysOnViaPlane
    ? { plane: planeServer, party: planeServer, jj: planeServer }
    : {
        plane: planeServer,
        party: headers ? { url: childMcp, headers } : { url: childMcp },
        jj: headers ? { url: childJj, headers } : { url: childJj },
      };
  const mcp = {
    mcpServers: {
      ...alwaysOn,
      ...Object.fromEntries(
        input.mcpServers.map((m) => [m.name, { url: m.url ?? `catalog://${m.name}` }]),
      ),
    },
  };
  const mcpPath = join(input.cwd, input.harness.mcpConfig);
  await writeFile(mcpPath, JSON.stringify(mcp, null, 2));
  files.push(mcpPath);
  await writeFile(join(input.cwd, "CLAUDE.md"), `${input.harness.systemText}\n`);
  await writeFile(join(input.cwd, ".metaprompt-prefix.txt"), prefix);
  return { prefixHash, files };
}

export function prefixInventory(harness: HarnessAdapter, skills: SkillRef[], mcpServers: McpRef[]) {
  return {
    alwaysOn: [...ALWAYS_ON_MCPS].sort(),
    schemas: ALWAYS_ON_SCHEMAS,
    catalogSkills: catalogSkillNames(skills),
    catalogMcps: catalogMcpNames(mcpServers),
    hash: computePrefixHash({ harness, skills, mcpServers }),
  };
}
