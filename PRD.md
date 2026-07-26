# PRD — "Baes" Personal Music Streaming Platform

**Version:** 0.1 (Draft)
**Owner:** xsebby
**Date:** 2026-07-26
**Reference project:** [Lumen](https://github.com/githubesson/lumen) — self-hosted, invite-only music library (Go backend, React/Expo clients, TIDAL sidecar)

---

## 1. Vision

A self-hosted, private music streaming platform for a large collection of **unreleased music and local files**. The library lives on a server the owner controls; it can be streamed from a phone, laptop, or any device, stays in sync automatically, and supports offline listening. Spotify is integrated as a *companion source*: playlists and saved music from Spotify are mirrored into the app so everything — unreleased files and Spotify listening — lives in one unified library view.

**One-liner:** "My entire music world — unreleased files + Spotify playlists — in one app, streamable anywhere, synced everywhere."

---

## 2. Goals & Non-Goals

### Goals
1. Ingest and index a large local-file collection (FLAC, WAV, MP3, M4A/AAC, OGG, AIFF), including messy/untagged unreleased tracks.
2. Stream from any device with instant seek (HTTP range requests) and adaptive quality (on-the-fly transcode for cellular).
3. Regular, automatic sync: library changes on the server appear on all clients; play state, queue position, playlists, likes, and play counts sync across devices.
4. Offline downloads on mobile with automatic re-sync when back online.
5. Spotify account link: import/mirror playlists, liked songs, and listening history; match Spotify tracks against the local library; hand off playback to the Spotify app for tracks that only exist on Spotify.
6. Privacy-first: this library contains unreleased music. Invite-only auth, no public endpoints by default, signed/expiring stream URLs.
7. Single React Native (Expo) codebase for iOS + Android, with a web client sharing the same core package.

### Non-Goals (v1)
- ❌ Streaming Spotify's actual audio through our own player (impossible: DRM; Spotify audio plays only via Spotify's own SDKs/app — see §8).
- ❌ Ripping/extracting Spotify downloads (DRM-protected; not technically or legally feasible).
- ❌ Public sharing/social features (Lumen's share pages, Replay) — deferred to v2.
- ❌ Multi-tenant SaaS. This is single-owner, small-invite-circle software.
- ❌ Music discovery/recommendations engine.

---

## 3. Users

| Persona | Description | Needs |
|---|---|---|
| **Owner (primary)** | Runs the server, owns the unreleased collection | Full admin: library roots, scans, invites, Spotify link, metadata editing |
| **Invited listener (optional)** | Friend given an invite token | Stream + playlist, no admin, possibly no download rights |

v1 can ship owner-only; the auth model should support invitees from day one (Lumen's invite-token model is the template).

---

## 4. System Architecture

```
┌─────────────────────────────── Server (Docker Compose) ───────────────────────────────┐
│                                                                                        │
│  ┌──────────────┐   ┌──────────────────┐   ┌────────────┐   ┌───────────────────────┐ │
│  │  PostgreSQL   │◄──│  API (Node/TS,   │──►│  ffmpeg     │   │  Spotify Sync Worker  │ │
│  │  + Drizzle    │   │  Fastify)        │   │  transcode  │   │  (playlist/library    │ │
│  └──────────────┘   │  - auth          │   │  pool       │   │   mirror + matcher)   │ │
│                     │  - library API   │   └────────────┘   └───────────────────────┘ │
│  ┌──────────────┐   │  - stream API    │                                              │
│  │ Music roots   │──►│  - sync API     │   ┌────────────┐                             │
│  │ (bind-mounted │   └──────────────────┘   │ Scanner /   │                            │
│  │  host dirs)   │◄─────────────────────────│ FS watcher  │                            │
│  └──────────────┘                           └────────────┘                             │
└────────────────────────────────────────────────────────────────────────────────────────┘
                    ▲ HTTPS (Caddy/Traefik reverse proxy, or Tailscale)
        ┌───────────┼──────────────────────┐
        │           │                      │
 ┌──────────────┐ ┌───────────────┐ ┌─────────────┐
 │ RN app (iOS) │ │ RN app (Andr.)│ │ Web client   │     All consume @baes/core
 └──────────────┘ └───────────────┘ └─────────────┘     (shared TS package)
```

### 4.1 Monorepo layout

```
baes/
├── apps/
│   ├── mobile/          # Expo (React Native) — iOS + Android
│   ├── web/             # React + Vite (v1.5; stub in v1)
│   └── server/          # Fastify API + workers
├── packages/
│   ├── core/            # shared: API client, player state, auth, sync engine, types
│   └── db/              # Drizzle schema + migrations (server-only import)
├── docker-compose.yml
└── PRD.md
```

### 4.2 Tech stack decisions

| Layer | Choice | Rationale |
|---|---|---|
| Backend | **Node 22 + TypeScript + Fastify** | One language across the whole monorepo; shared types between server and RN app via `@baes/core`. (Lumen uses Go; we trade some raw perf for end-to-end type sharing. Streaming is I/O-bound and Node handles range-serving fine.) |
| DB | **PostgreSQL 16 + Drizzle ORM** | Relational fits library data; full-text search via `pg_trgm`/`tsvector`; Drizzle gives typed queries + migrations |
| Audio probing | `ffprobe`; tags via `music-metadata` (handles FLAC/ID3/MP4 atoms) | Battle-tested, pure-TS tag reader |
| Transcoding | ffmpeg (spawned pool, LRU disk cache of transcoded segments) | Same approach as Lumen |
| Mobile | **Expo SDK (dev-client, not Expo Go)** + `react-native-track-player` | Track player gives background audio, lock-screen controls, CarPlay/Android Auto later |
| Offline store | `expo-file-system` + SQLite (`expo-sqlite`) mirror of library metadata | Full offline browsing, not just cached blobs |
| Web player | HTMLAudioElement + MediaSession API | v1.5 |
| Auth | Argon2id + HTTP-only cookie session (web) / opaque bearer token (mobile), invite tokens | Mirrors Lumen's model |
| Networking | HTTPS via Caddy **or** Tailscale-only mode | Owner picks exposure level; Tailscale default for max privacy |
| Push/sync signal | Server-Sent Events (SSE) channel per client; mobile falls back to poll-on-foreground + background fetch task | Simpler than WebSockets for one-way invalidation |

---

## 5. Feature Specification

### 5.1 Library ingestion & scanning

- **Multiple music roots** configured by the owner (e.g. `/music/unreleased`, `/music/rips`). Bind-mounted into the container at identical paths (Lumen pattern).
- **Initial scan:** walk roots, ffprobe each file, extract tags + embedded art, compute:
  - `content_hash` — SHA-256 of file bytes (dedupe, change detection)
  - `audio_fingerprint` — Chromaprint/AcoustID fingerprint (dedupe *across formats* and Spotify matching support)
  - duration, bitrate, sample rate, channels, codec
- **Watch mode:** `chokidar` on roots → debounce → incremental scan. Manual "Rescan" button in admin.
- **Untagged/unreleased handling** (critical — unreleased files are often `artist - title (v2 FINAL).mp3` with zero tags):
  - Filename-pattern heuristics (`{artist} - {title}`, `{title} (feat. X) [v3]`, date prefixes) to propose metadata
  - "Needs review" inbox in admin UI listing low-confidence imports; owner confirms/edits in bulk
  - Version grouping: files whose fingerprints are near-identical are clustered as "versions" of one track (v1: exact fingerprint match; fuzzy clustering v2)
- **Metadata editing:** inline edit for track/album/artist, cover-art upload, batch edit. DB is the source of truth; an opt-in "write tags back to file" toggle (per edit or bulk) persists corrections into the source files, backing up the original file on first write.

### 5.2 Streaming & playback

- **Direct stream endpoint:** `GET /api/stream/:trackId` supporting `Range` headers → instant scrubbing, no full-file buffering.
- **Quality ladder:**
  | Profile | Codec | Target | Use |
  |---|---|---|---|
  | `original` | passthrough | source | Wi-Fi / lossless lovers |
  | `high` | Opus 192k (or AAC 256k for iOS compat) | ~192kbps | default cellular |
  | `low` | Opus 96k | ~96kbps | data saver |
  - Transcodes produced by ffmpeg on demand, cached on disk (LRU, configurable cap e.g. 20 GB).
  - Client policy: per-network-type quality setting (Wi-Fi / cellular / downloads each independently configurable).
- **Signed stream URLs:** every stream/artwork URL carries a short-lived HMAC token (leak protection for unreleased material — a copied URL dies in minutes).
- **Player (mobile):** `react-native-track-player`: background playback, lock-screen/notification controls, gapless within queue, sleep timer, playback speed. Queue semantics: play-now / play-next / add-to-queue, shuffle, repeat one/all.
- **Scrobble/play tracking:** client posts play events (trackId, ms played, source device); powers history, "recently played", and per-track counts.

### 5.3 Sync engine

The contract: *anything you do on one device shows up on the others without thinking about it.*

- **Library sync (server → client):** server maintains a monotonically increasing `change_seq` (per-row `updated_seq` columns). Clients store `last_seq` and pull deltas: `GET /api/sync/changes?since=<seq>` returns upserts/tombstones for tracks, albums, artists, playlists, likes. Mobile keeps a full SQLite mirror → instant cold-start browsing, full offline browsing.
- **Sync triggers:** SSE push while foregrounded; OS background-fetch task (15-min-class cadence) otherwise; always on app foreground.
- **Playback state sync ("continue where I left off"):** client heartbeats now-playing (track, position, queue snapshot-id) every ~20 s while playing; other devices can "resume from phone" (explicit pull, not forced handoff — v1 keeps this simple).
- **Playlist edits offline:** queued mutations (add/remove/reorder) stored locally, replayed on reconnect. Conflict policy: last-writer-wins per playlist item; reorder conflicts resolved by server ordering with fractional indexes (e.g. LexoRank-style keys).
- **Downloads sync:** "downloaded" is a per-device flag, but *download rules* sync — e.g. "keep playlist X offline on my phone" auto-downloads new tracks added to X.

### 5.4 Offline downloads (mobile)

- Download individual tracks, albums, playlists at a chosen quality profile.
- Smart storage: cap setting, LRU eviction of *non-pinned* cached tracks; pinned downloads never auto-evicted.
- Downloads encrypted at rest? **v1: no** (files land in app-sandboxed storage, already inaccessible to other apps on iOS/Android); revisit if invitees get download rights.
- Fully offline session: browse mirror, play downloads, edit playlists (queued), record play events (queued).

### 5.5 Spotify integration

**Hard constraint (be honest with ourselves):** Spotify audio cannot be streamed by third-party players and downloaded Spotify content is DRM-locked. What the Web API *does* allow: reading playlists, liked songs, recently played, top items; and the **iOS/Android App Remote SDKs** allow controlling playback *in the installed Spotify app* (Premium).

So the integration is three capabilities:

1. **Mirror (metadata):** OAuth (Authorization Code + PKCE) link in settings. Server-side worker syncs on schedule (e.g. hourly) + manual refresh:
   - All playlists (owned + followed), liked songs, recently played.
   - Stored as `external_tracks` (Spotify ID, ISRC, title, artist, album, duration, art URL) and `playlists` with mixed-source items — the Lumen "mixed local + remote playlist" pattern.
2. **Match:** For every mirrored Spotify track, attempt to find it in the local library:
   - Tier 1: ISRC ↔ tag ISRC exact match
   - Tier 2: normalized `artist+title` + duration within ±2 s
   - Tier 3: fuzzy title/artist (trigram similarity) → "possible match" for manual confirm
   - Matched tracks play **locally** (our stream) even inside a mirrored Spotify playlist. Match review UI shows confidence.
3. **Handoff (playback of unmatched tracks):** tapping an unmatched Spotify track:
   - Preferred: Spotify App Remote SDK — starts playback in the Spotify app, our UI shows "Playing via Spotify" state.
   - Fallback: deep-link `spotify:track:<id>`.
   - Mixed queue behavior v1: a queue is either local-engine or Spotify-remote at any moment; auto-advance across the boundary is **v2** (App Remote's delegate callbacks make this possible but fiddly).

**Spotify branding/ToS note:** using their metadata requires attribution and their design guidelines (logo next to Spotify content, no caching of art beyond ToS limits). Personal-use app reduces risk, but if invitees are added, review Developer Terms.

### 5.6 Auth, privacy & security

Unreleased music leaking is the nightmare scenario. Treat the server as hostile-internet-facing even if it's Tailscale-only.

- Invite-only registration (admin-issued single-use tokens); Argon2id hashing; sessions in HTTP-only, `SameSite=Strict` cookies (web) / opaque tokens with server-side revocation (mobile).
- Signed, expiring URLs for all media (stream + artwork). No unauthenticated endpoint serves bytes.
- Per-user roles: `owner`, `listener` (no admin, optional `can_download`).
- Rate limiting on auth + stream endpoints; audit log of logins and (optionally) per-user stream events.
- Deployment modes: (a) public HTTPS behind Caddy with automatic certs (**default — VPS hosting**), (b) Tailscale-only lockdown mode (no public port).
- Backups: nightly `pg_dump` + the music roots are the owner's responsibility (documented; script provided).

### 5.7 Client UX (React Native) — screen inventory

| Screen | Contents |
|---|---|
| **Home** | Recently added, recently played, pinned playlists, "continue listening" |
| **Library** | Tabs: Tracks / Albums / Artists / Playlists; sort + filter (source: local/Spotify); A-Z fast scroll |
| **Search** | Unified full-text (local + mirrored Spotify), sectioned results |
| **Album / Artist / Playlist detail** | Art, track list, download toggle, source badges (local file / Spotify / matched) |
| **Now Playing** | Art, scrubber, queue sheet, quality indicator, cast/handoff affordance |
| **Downloads** | Managed storage view, per-item pin/evict |
| **Needs Review** (owner) | Untagged-import inbox, Spotify match confirmations |
| **Admin** (owner) | Library roots, scan status/trigger, invites, users, Spotify link, transcode cache stats |
| **Settings** | Quality per network, download rules, account, server URL, theme |

Design language: dark-first, edge-to-edge art, big type. (Detailed design spec is a separate doc.)

---

## 6. Data Model (core tables)

```
users(id, username, pw_hash, role, created_at)
invites(token, created_by, used_by, expires_at)
sessions(id, user_id, token_hash, device_name, last_seen, revoked)

library_roots(id, path, enabled)
tracks(id, root_id, rel_path, content_hash, fingerprint, title, artist_id, album_id,
       track_no, disc_no, duration_ms, codec, bitrate, sample_rate, isrc,
       needs_review, version_group_id, updated_seq, deleted_at)
albums(id, title, artist_id, year, art_path, updated_seq)
artists(id, name, sort_name, updated_seq)

external_accounts(id, user_id, provider='spotify', refresh_token_enc, scopes, last_sync_at)
external_tracks(id, provider, provider_id, isrc, title, artist, album, duration_ms,
                art_url, matched_track_id, match_confidence, match_status)

playlists(id, owner_id, title, source('local'|'spotify'), provider_id, updated_seq)
playlist_items(id, playlist_id, sort_key, track_id NULLABLE, external_track_id NULLABLE, added_by, updated_seq)

likes(user_id, track_id | external_track_id, created_at, updated_seq)
play_events(id, user_id, track_id|external_track_id, device_id, played_ms, started_at)
player_state(user_id, device_id, track_ref, position_ms, queue_json, updated_at)
transcode_cache(track_id, profile, path, bytes, last_access)
```

`updated_seq` columns feed the delta-sync API; a global sequence (`nextval`) stamps every mutation.

---

## 7. API Surface (sketch)

```
POST   /api/auth/login | /logout | /invite/redeem
GET    /api/sync/changes?since=<seq>          # delta sync (all entity types, paginated)
GET    /api/sync/stream                       # SSE: "changes available" pings
GET    /api/tracks/:id  /albums/:id  /artists/:id
GET    /api/search?q=
GET    /api/stream/:trackId?profile=&sig=&exp=
GET    /api/art/:id?size=&sig=&exp=
POST   /api/playlists  /playlists/:id/items   # + PATCH/DELETE, batch ops
POST   /api/plays                             # play-event batch upload
PUT    /api/player-state
POST   /api/admin/scan     GET /api/admin/scan/status
POST   /api/admin/invites  GET /api/admin/users
POST   /api/spotify/link   POST /api/spotify/sync   GET /api/spotify/matches
POST   /api/spotify/matches/:id/confirm|reject
```

---

## 8. Constraints & Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Spotify audio can't be played in-app | Users may expect one seamless player | Set expectation in UI ("via Spotify" badge); maximize local matching so most playlist tracks play natively |
| Spotify App Remote requires Premium + installed app | Handoff broken for free accounts | Deep-link fallback always works |
| Unreleased music leak | Catastrophic | Tailscale-default, signed URLs, invite-only, audit log, no public share in v1 |
| iOS background-sync limits | Stale library on phone | SQLite mirror makes staleness cosmetic; sync on foreground is instant delta |
| Huge messy libraries (10k+ untagged files) | Scan quality poor, review inbox overwhelming | Heuristics + bulk edit tooling; fingerprint dedupe collapses duplicates first |
| ffmpeg transcode CPU on small servers | Playback stalls | Disk cache; pre-transcode-on-download; `original` profile bypasses ffmpeg |
| Expo + track-player native module friction | Build pain | Use Expo dev-client/EAS from day 1 (not Expo Go) |

---

## 9. Milestones

**M0 — Foundation (repo, infra)**
Monorepo scaffold, Docker Compose (Postgres + server), CI, Drizzle schema v1, auth (login/invite/session).

**M1 — Library core (server)**
Scanner + watcher, tag extraction, art pipeline, fingerprinting, dedupe, needs-review flow, search, range streaming + signed URLs.

**M2 — Mobile MVP**
Expo app: auth, library browse (SQLite mirror + delta sync), search, now-playing with react-native-track-player, queue, play events. *At the end of M2 you can stream your library from your phone.*

**M3 — Transcoding + offline**
Quality ladder, transcode cache, downloads + pinning + storage manager, offline session support, download rules.

**M4 — Spotify**
OAuth link, mirror worker, matcher (ISRC/exact/fuzzy tiers), match review UI, mixed playlists, App Remote handoff.

**M5 — Polish + sync hardening**
Playback-state sync/resume, playlist offline mutations + conflict handling, admin screens, web client (shares @baes/core), backups doc.

---

## 10. Build Plan — Task Breakdown with Model Assignment

Convention: **Fable** = frontier reasoning (architecture, concurrency, gnarly integration), **Opus** = heavy implementation with judgment, **Sonnet** = well-scoped implementation, CRUD, UI screens, tests-from-spec. Tasks marked Fable+Opus mean: Fable designs/reviews, Opus implements.

### M0 — Foundation
| Task | Model | Notes |
|---|---|---|
| Monorepo scaffold (pnpm workspaces, TS config, Expo app init, Fastify init) | Sonnet | Mechanical, well-trodden |
| Docker Compose + Caddy/Tailscale deployment modes | Sonnet | |
| Drizzle schema v1 + migration setup | Opus | Schema decisions ripple everywhere; worth judgment |
| Auth system (Argon2id, sessions, invites, token revocation) | **Fable + Opus** | Security-critical; Fable reviews design + implementation |
| CI (lint, typecheck, test, EAS build hooks) | Sonnet | |

### M1 — Library core
| Task | Model | Notes |
|---|---|---|
| Scanner architecture (walker, ffprobe pool, incremental diffing vs content_hash, watcher debounce) | **Fable** design → **Opus** implement | Correctness under concurrent FS churn is genuinely hard |
| Tag extraction + art pipeline | Sonnet | Library-driven |
| Chromaprint fingerprinting + duplicate/version clustering | **Fable + Opus** | Cross-format dedupe logic + clustering thresholds |
| Filename-heuristic metadata inference for untagged files | Opus | Fuzzy, needs judgment; testable |
| Needs-review inbox API + bulk edit endpoints | Sonnet | CRUD |
| Full-text search (tsvector/trgm indexes, ranking) | Opus | |
| Range-request streaming endpoint + signed URL scheme (HMAC, expiry, revocation) | **Fable + Opus** | Streaming edge cases (range math, client aborts) + security |

### M2 — Mobile MVP
| Task | Model | Notes |
|---|---|---|
| Delta-sync protocol design (`updated_seq`, tombstones, pagination, SSE invalidation) | **Fable** | The single hardest design in the project; get it right once |
| Sync engine client implementation (SQLite mirror, resumable delta pull, migration of mirror schema) | **Opus** (Fable review) | |
| App navigation shell + theming + design system components | Sonnet | |
| Library screens (tracks/albums/artists/playlists, A-Z scroll, sort/filter) | Sonnet | |
| Search screen | Sonnet | |
| react-native-track-player integration (background audio, lock screen, queue semantics, gapless) | **Fable + Opus** | Native-module land; platform quirks galore |
| Now Playing + queue UI | Sonnet | |
| Play-event batching + upload | Sonnet | |
| Auth screens + server-URL onboarding | Sonnet | |

### M3 — Transcoding + offline
| Task | Model | Notes |
|---|---|---|
| ffmpeg transcode pool + LRU disk cache (concurrency caps, partial-request handling mid-transcode) | **Fable + Opus** | Streaming *while* transcoding is the hard part |
| Quality-policy client logic (network detection, per-context profiles) | Sonnet | |
| Download manager (queue, resume, integrity check, pin/evict, storage caps) | **Opus** | Long-running background transfers on iOS need care |
| Offline mode (mirror-only browsing, queued mutations, queued play events) | **Opus** (Fable review of conflict policy) | |
| Downloads UI + storage manager screen | Sonnet | |

### M4 — Spotify
| Task | Model | Notes |
|---|---|---|
| OAuth PKCE flow + encrypted refresh-token storage + sync worker scheduling | Opus | |
| Playlist/likes/history mirror (pagination, rate limits, incremental diffing via snapshot_id) | Opus | |
| Track matcher (ISRC → exact → fuzzy trigram tiers, confidence scoring) | **Fable + Opus** | Matching quality makes or breaks the feature |
| Match review UI | Sonnet | |
| Mixed-source playlists (data model already supports; rendering + play routing) | Sonnet | |
| App Remote SDK handoff (iOS + Android native modules, session mgmt, "playing via Spotify" state) | **Fable + Opus** | Two native SDKs, lifecycle pain |

### M5 — Polish + hardening
| Task | Model | Notes |
|---|---|---|
| Playback-state sync + "resume from other device" | Opus | |
| Playlist conflict resolution (fractional-index reorder, LWW semantics) | **Fable** design → Opus | |
| Admin screens (scan status, invites, users, cache stats) | Sonnet | |
| Web client (reuse @baes/core; HTMLAudio player) | Sonnet | |
| Security pass (rate limits, audit log, headers, dependency audit) | **Fable** | Adversarial review |
| Backup/restore scripts + deployment docs | Sonnet | |

---

## 11. Resolved Decisions

1. **Hosting: VPS.** Deploy behind Caddy with automatic HTTPS; Tailscale remains an optional lockdown mode. Transcode budget is modest — the disk cache and pre-transcode-on-download matter more on VPS-class CPUs.
2. **Owner-only for v1.** Invite/auth model stays in the schema (it's nearly free), but no invitee UI or `listener` role work until v2.
3. **`high` (192k) is the v1 quality bar.** The `original` passthrough profile stays available since it costs nothing (no ffmpeg involved), but no lossless-specific work (e.g. FLAC-on-cellular polish) in v1.
4. **Spotify Premium confirmed** → App Remote handoff is the primary path for unmatched tracks; deep-link fallback kept as a safety net.
5. **Tag write-back is in scope.** Corrected metadata can be written back into the source files via an explicit per-edit/bulk toggle (DB remains the source of truth; write-back is opt-in per operation, with original-file backup on first write).
6. **CarPlay / Android Auto: v2.** Not a v1 requirement; react-native-track-player keeps the door open.

---

## 12. Success Criteria (v1 = end of M5)

- Full library scanned and browsable on phone within seconds of app open, including fully offline.
- Any track streams with <1 s start time on Wi-Fi, seek is instant, cellular uses transcoded profile automatically.
- A playlist edited on the laptop appears on the phone within one foreground/sync cycle (<15 min background, instant foreground).
- Spotify playlists visible in-app; ≥80 % of Spotify tracks that exist in the local library auto-matched at Tier 1/2; unmatched tracks hand off to the Spotify app in ≤2 taps.
- Zero unauthenticated byte-serving endpoints; stream URLs expire; failed-login rate limiting verified.
