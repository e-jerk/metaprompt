# syntax=docker/dockerfile:1
# Fat root-session image: OpenCode, Claude Code, Codex, and Cursor CLI on the runner.
FROM runner
USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates nodejs \
  && rm -rf /var/lib/apt/lists/*
RUN bun add -g opencode-ai@latest @anthropic-ai/claude-code@latest @openai/codex@latest
RUN curl -fsSL https://cursor.com/install | bash \
  && printf '%s\n' '#!/bin/sh' 'exec bun /app/packages/runner/src/cursor-cli.ts "$@"' > /usr/local/bin/metaprompt-cursor \
  && chmod +x /usr/local/bin/metaprompt-cursor
ENV PATH="/root/.local/bin:/usr/local/bin:${PATH}"
ENV METAPROMPT_HARNESS=session
WORKDIR /workspace
CMD ["bun", "/app/packages/runner/src/session.ts"]
