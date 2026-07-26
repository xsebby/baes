FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/db/package.json packages/db/
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --filter @baes/server... --filter @baes/db --filter @baes/core
COPY packages ./packages
COPY apps/server ./apps/server
RUN pnpm --filter @baes/db build && pnpm --filter @baes/core build && pnpm --filter @baes/server build
RUN pnpm --filter @baes/server --prod deploy /app

FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app .
EXPOSE 4000
USER node
CMD ["node", "dist/index.js"]
