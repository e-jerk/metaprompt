# syntax=docker/dockerfile:1
FROM runner
RUN bun add -g @openai/codex@latest
ENV METAPROMPT_HARNESS=codex
CMD ["bun", "/app/packages/runner/src/main.ts"]
