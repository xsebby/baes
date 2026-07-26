# baes

Self-hosted music streaming for unreleased tracks and local files, with Spotify library mirroring. See [PRD.md](PRD.md) for the full spec.

## Layout

- `apps/server` — Fastify API (auth, library, streaming, sync)
- `apps/mobile` — Expo / React Native app (iOS + Android)
- `packages/core` — shared TypeScript: API client, types
- `packages/db` — Drizzle schema + migrations (PostgreSQL)

## Local dev (no Docker needed)

```bash
pnpm install
pnpm dev          # starts the API on :4000 with embedded PGlite storage
```

Then in another terminal:

```bash
cd apps/mobile && pnpm start   # Expo dev server
```

On first run, use "Fresh server? Create owner account" in the app (or `POST /api/auth/setup`) to create the owner.

## Tests

```bash
pnpm -r test
```

## Deploy (VPS)

```bash
cp .env.example .env   # fill in POSTGRES_PASSWORD, SERVER_SECRET, DOMAIN
docker compose up -d --build
```

Caddy terminates TLS for `$DOMAIN` and proxies to the API. Mount your music folders into the `server` service (see the commented volume in `docker-compose.yml`).
