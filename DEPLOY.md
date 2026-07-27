# Deploying baes to a VPS

The end state: your music lives on the VPS, the server streams it over HTTPS at
`https://your-domain`, and the app works from anywhere — not just home Wi-Fi.

## What you need

1. **A VPS** — any provider (Hetzner, DigitalOcean, Vultr, …). 2 GB RAM is plenty;
   pick disk size by library size. Ubuntu 24.04 assumed below.
2. **A domain (or subdomain)** you control, with an **A record** pointing at the
   VPS IP (e.g. `music.yourdomain.com → 203.0.113.7`). Caddy issues TLS
   certificates automatically once DNS resolves.
3. SSH access to the VPS.

## One-time VPS setup

```bash
# as root on the VPS
apt-get update && apt-get install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sh

# app user + music folder
useradd -m -s /bin/bash baes && usermod -aG docker baes
mkdir -p /srv/music && chown baes:baes /srv/music
```

## Deploy

```bash
# as the baes user
git clone https://github.com/xsebby/baes.git && cd baes
cp .env.example .env
nano .env    # set POSTGRES_PASSWORD, SERVER_SECRET (openssl rand -base64 48), DOMAIN, MUSIC_DIR
docker compose up -d --build
```

First boot runs DB migrations automatically. Check health:

```bash
curl -s https://YOUR_DOMAIN/api/health
```

Then in the app: sign out, sign in to `https://YOUR_DOMAIN`, create the owner
account (fresh database), add `/srv/music` as a library root, scan.

## Getting music onto the VPS

**One-shot copy** from the Windows PC: use WinSCP (GUI) pointed at the VPS, drop
your music folder into `/srv/music`.

**Continuous sync (recommended):** install [Syncthing](https://syncthing.net) on
the PC and the VPS, share your music folder → `/srv/music`. Anything you drop in
the folder on the PC appears on the VPS; a rescan picks it up in the app.
(A filesystem watcher that auto-rescans is on the roadmap.)

## Updating the server

```bash
cd ~/baes && git pull && docker compose up -d --build
```

## Notes

- Postgres data, extracted art, and the transcode cache live in named Docker
  volumes (`docker volume ls`). Nightly `pg_dump` backup script: TODO (M5).
- The stream/art URLs are HMAC-signed and expire hourly; nothing serves bytes
  without a valid signature. Auth endpoints are rate-limited.
- Tighter lockdown (optional): install Tailscale on the VPS + your devices and
  set `DOMAIN` to the tailnet name — no public port at all.
