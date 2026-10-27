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

# baes-fingerprint's `fp` CLI, for duplicate-recording detection. The repo is
# private, so the download needs a token, passed as a BuildKit secret (never
# stored in a layer). Without one this stage leaves /fp/out empty, and the
# server runs with duplicate detection off.
FROM node:22-slim AS fp
ARG FP_REF=ee6b88f34864b14db62c5ca69c8e0435b6905b78
# Secrets aren't part of BuildKit's cache key, so a build that ran without the
# token would be reused as-is once the token is added. CI passes whether the
# secret is set, which puts its presence into the key.
ARG FP_TOKEN_SET=false
RUN apt-get update && apt-get install -y --no-install-recommends cmake ninja-build g++ curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN --mount=type=secret,id=fp_token \
    mkdir -p /fp/out && \
    if [ -s /run/secrets/fp_token ]; then \
      curl -fsSL -H "Authorization: Bearer $(cat /run/secrets/fp_token)" \
        "https://api.github.com/repos/xsebby/baes-fingerprint/tarball/${FP_REF}" -o /tmp/fp.tgz \
      && mkdir /fp/src && tar -xzf /tmp/fp.tgz -C /fp/src --strip-components=1 \
      && cmake -S /fp/src -B /fp/build -G Ninja -DCMAKE_BUILD_TYPE=Release \
           -DFP_BUILD_TESTS=OFF -DFP_BUILD_BENCH=OFF \
      && cmake --build /fp/build --target fpcli \
      && cp /fp/build/fp /fp/out/fp; \
    elif [ "$FP_TOKEN_SET" = true ]; then \
      echo "FP_TOKEN_SET=true but no fp_token secret was mounted" >&2; exit 1; \
    else echo "no fp_token secret: building without duplicate detection"; fi

FROM node:22-slim
ARG GIT_SHA=dev
LABEL org.opencontainers.image.source=https://github.com/xsebby/baes
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp
WORKDIR /app
ENV NODE_ENV=production
ENV APP_COMMIT=$GIT_SHA
COPY --from=build /app .
COPY --from=build /repo/apps/web/dist ./public
COPY --from=fp /fp/out/ /usr/local/bin/
ENV FP_BIN=/usr/local/bin/fp
# Volume mount points must exist and belong to the runtime user before the
# named volumes are first created, or they materialize root-owned.
RUN mkdir -p /app/.data /app/transcode-cache && chown -R node:node /app/.data /app/transcode-cache
EXPOSE 4000
USER node
CMD ["node", "dist/index.js"]
