FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/db/package.json packages/db/
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
# The lockfile knows every workspace importer, so mobile's manifest must exist
# even though nothing from it is installed here.
COPY apps/mobile/package.json apps/mobile/
RUN pnpm install --frozen-lockfile --filter @baes/server... --filter @baes/web...
COPY packages ./packages
COPY apps/server ./apps/server
COPY apps/web ./apps/web
RUN pnpm --filter @baes/db build && pnpm --filter @baes/core build && pnpm --filter @baes/server build && pnpm --filter @baes/web build
RUN pnpm --filter @baes/server deploy --prod --legacy /app

FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app .
COPY --from=build /repo/apps/web/dist ./public
# Volume mount points must exist and belong to the runtime user before the
# named volumes are first created, or they materialize root-owned.
RUN mkdir -p /app/.data /app/transcode-cache && chown -R node:node /app/.data /app/transcode-cache
EXPOSE 4000
USER node
CMD ["node", "dist/index.js"]
