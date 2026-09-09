import type { HarnessAdapter, Run } from "@metaprompt/shared";

export function commandFor(harness: HarnessAdapter, run: Run, resume: boolean): { argv: string[]; env: Record<string, string> } {
  const argv = [...(resume ? harness.resumeCommand : harness.command)];
  const env: Record<string, string> = {
    METAPROMPT_RUN_ID: run.id,
    METAPROMPT_HARNESS: harness.name,
    METAPROMPT_DISALLOWED_TOOLS: harness.disallowedTools.join(","),
  };
  if (run.resolvedModel?.provider === "bedrock") {
    env.CLAUDE_CODE_USE_BEDROCK = "1";
    env.AWS_REGION = process.env.AWS_REGION ?? "us-east-1";
    if (harness.name === "claude-code") argv.push("--model", run.resolvedModel.vendorId ?? "");
    if (harness.name === "opencode") argv.push("-m", `amazon-bedrock/${run.resolvedModel.vendorId}`);
  }
  if (run.resolvedModel?.provider === "cursor") {
    env.CURSOR_MODEL = run.resolvedModel.vendorId ?? "auto";
  }
  if (run.resolvedModel?.provider === "openai" && run.resolvedModel.vendorId) {
    argv.push("--model", run.resolvedModel.vendorId);
  }
  if (harness.name === "opencode" && run.resolvedModel?.provider === "opencode") {
    argv.push("-m", run.resolvedModel.vendorId ?? `opencode/${run.resolvedModel.id}`);
  }
  if (run.prompt && !resume) argv.push(run.prompt);
  if (run.resumeSuffix && resume) argv.push(run.resumeSuffix);
  return { argv, env };
}

/** TUI / exec session: model flags only, no one-shot prompt. */
export function interactiveFor(
  harness: HarnessAdapter,
  run: Pick<Run, "id" | "resolvedModel">,
): { argv: string[]; env: Record<string, string> } {
  const argv = [...(harness.interactiveCommand ?? harness.command)];
  const env: Record<string, string> = {
    METAPROMPT_RUN_ID: run.id,
    METAPROMPT_HARNESS: harness.name,
    METAPROMPT_DISALLOWED_TOOLS: harness.disallowedTools.join(","),
  };
  if (run.resolvedModel?.provider === "bedrock") {
    env.CLAUDE_CODE_USE_BEDROCK = "1";
    env.AWS_REGION = process.env.AWS_REGION ?? "us-east-1";
    if (harness.name === "claude-code") argv.push("--model", run.resolvedModel.vendorId ?? "");
    if (harness.name === "opencode") argv.push("-m", `amazon-bedrock/${run.resolvedModel.vendorId}`);
  }
  if (run.resolvedModel?.provider === "cursor") {
    env.CURSOR_MODEL = run.resolvedModel.vendorId ?? "auto";
  }
  if (run.resolvedModel?.provider === "openai" && run.resolvedModel.vendorId) {
    argv.push("--model", run.resolvedModel.vendorId);
  }
  if (harness.name === "opencode" && run.resolvedModel?.provider === "opencode") {
    argv.push("-m", run.resolvedModel.vendorId ?? `opencode/${run.resolvedModel.id}`);
  }
  return { argv, env };
}

export function bedrockOmitsAnthropicKey(run: Run): boolean {
  return run.resolvedModel?.provider === "bedrock";
}
