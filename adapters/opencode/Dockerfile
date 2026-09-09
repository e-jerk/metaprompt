# syntax=docker/dockerfile:1
FROM runner
# Vendor CLI (often Node). Our runner stays bun. Disallow in-process agent spawn.
RUN bun add -g opencode-ai@latest
ENV METAPROMPT_HARNESS=opencode
CMD ["bun", "/app/packages/runner/src/main.ts"]
