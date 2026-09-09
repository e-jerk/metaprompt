# syntax=docker/dockerfile:1
FROM oven/bun:1.3
WORKDIR /app
COPY package.json bun.lock tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/mcp/package.json packages/mcp/package.json
COPY packages/runner/package.json packages/runner/package.json
RUN bun install --frozen-lockfile --production
COPY packages/shared packages/shared
COPY packages/mcp packages/mcp
ENV NODE_ENV=production
EXPOSE 3333
CMD ["bun", "packages/mcp/src/main.ts"]
