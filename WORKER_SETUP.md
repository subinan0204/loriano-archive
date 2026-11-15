# Playlist sync Worker

- `playlist-sync-worker.mjs` is the Cloudflare Worker entry point.
- `wrangler.toml` binds the existing KV namespace `loriano-playlist-catalog` and schedules the daily Cron at 00:17 UTC (09:17 Korea Standard Time).
- Cloudflare Worker Secrets are named `YOUTUBE_API_KEY` and `ADMIN_TOKEN`. Do not add their values to this repository. Both names are already configured as encrypted Secrets on the existing Worker.
- Public snapshot: `GET /api/playlist`. Manual refresh: `POST /api/sync` with `Authorization: Bearer <ADMIN_TOKEN>`. The endpoint writes a single KV value only after every playlist and metadata page has completed and passed validation.
- Health check: `GET /health`.
- Test: `node playlist-sync-worker.test.mjs` (uses mocked YouTube responses and never calls the real API).
