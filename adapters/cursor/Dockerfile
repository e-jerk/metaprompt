# syntax=docker/dockerfile:1
FROM runner
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL https://cursor.com/install | bash \
  && printf '%s\n' '#!/bin/sh' 'exec bun /app/packages/runner/src/cursor-cli.ts "$@"' > /usr/local/bin/metaprompt-cursor \
  && chmod +x /usr/local/bin/metaprompt-cursor
ENV PATH="/root/.local/bin:/usr/local/bin:${PATH}"
ENV METAPROMPT_HARNESS=cursor
CMD ["bun", "/app/packages/runner/src/main.ts"]
