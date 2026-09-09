# syntax=docker/dockerfile:1
FROM runner
# Vendor CLI. Task/subagent tools are disallowed by the catalog.
RUN bun add -g @anthropic-ai/claude-code@latest
ENV METAPROMPT_HARNESS=claude-code
CMD ["bun", "/app/packages/runner/src/main.ts"]
