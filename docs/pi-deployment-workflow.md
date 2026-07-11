# Pi Deployment Workflow

This project deploys to the Raspberry Pi as a self-contained `wordbee` app
folder under:

```bash
/home/chungy/apps/wordbee
```

The Pi is the production runtime, not the source of truth. Make code changes in
the local dev checkout, test locally, build a deploy bundle, zip it, and move the
zip to the Pi.

## Important Production Rule

The live Pi database folder is permanent production state:

```bash
/home/chungy/apps/wordbee/data
```

Do not replace it with a bundled local `data` folder after launch. The first
deployment intentionally scrubbed dummy users/results and shipped a clean DB,
but future deploys must preserve the Pi's live `data` directory unless a
specific migration requires controlled changes.

## What The Deployment Bundle Contains

The deploy bundle should include:

- `backend/`
- `frontend/dist/`
- `scripts/`
- `deploy/` copied from tracked `infra/`
- `.env` / `.env.example`
- `LICENSE`
- `data/` only for first launch or for non-production seed/archive files when
  explicitly intended

The production app uses:

- systemd service: `/etc/systemd/system/wordbee.service`
- app root: `/home/chungy/apps/wordbee`
- Flask/Gunicorn API: `127.0.0.1:5001`
- nginx static/proxy config: `/etc/nginx/sites-available/wordbee`
- cloudflared service: `cloudflared-matthewbisbee`
- hostname: `wordbee.matthewbisbee.com`

## Build A Fresh Bundle Locally

From the dev machine, create a fresh folder beside `fnf-wordle`, usually named
`READY`, using the current working tree.

Suggested contents:

```bash
cd "/Users/matthewbisbee/Documents/Web Dev/Wordle"
mkdir -p READY READY/scripts READY/frontend READY/deploy
cp -R fnf-wordle/backend READY/backend
cp -R fnf-wordle/infra READY/deploy
cp fnf-wordle/LICENSE READY/LICENSE
cp fnf-wordle/scripts/manage_users.py READY/scripts/manage_users.py
cp fnf-wordle/scripts/maintenance.sh READY/scripts/maintenance.sh
cp fnf-wordle/scripts/announcement.sh READY/scripts/announcement.sh
cp fnf-wordle/scripts/install-pi.sh READY/scripts/install-pi.sh
cp fnf-wordle/scripts/run-gunicorn.sh READY/scripts/run-gunicorn.sh
```

Build the frontend directly into the bundle:

```bash
npm --prefix fnf-wordle/frontend run build -- \
  --outDir "/Users/matthewbisbee/Documents/Web Dev/Wordle/READY/frontend/dist" \
  --emptyOutDir
```

Make scripts executable:

```bash
chmod +x READY/scripts/*.sh
```

## Production Environment File

The production `.env` should be filtered from the dev `.env`. Keep only runtime
settings such as:

- `SECRET_KEY`
- `WORDBEE_PUZZLE_TIMEZONE`
- `WORDBEE_FRIENDS_FAMILY_CODES`
- `WORDBEE_NTFY_*`
- `WORDBEE_MULTIGAME_WARMUP_ENABLED`
- `WORDBEE_MULTIGAME_WARMUP_RETRY_SECONDS`
- `WORDBEE_ANNOUNCEMENT_TIMEZONE`

Do not include dev/archive-only values:

- `NYT_COOKIE`
- `FLASK_ENV`
- `DATABASE_PATH`
- `WORDBEE_ENABLE_DEV_FALLBACK`

## Zip Transfer Shape

The zip that worked in production contained the app files directly under a
top-level `Wordbee` folder inside the archive. If it unpacks as
`wordbee/Wordbee`, flatten it on the Pi:

```bash
cd /home/chungy/apps
mv wordbee wordbee_unpack
mv wordbee_unpack/Wordbee wordbee
```

After confirming the app works, `wordbee_unpack` can be removed.

## First Launch Only: Scrub Dummy Data

The first launch used a copied local DB and removed dummy/user/stat rows from
`wordbee.sqlite` while preserving puzzle archives and backfill state.

Tables scrubbed:

- `completed_games`
- `friends_family_daily_analysis`
- `friends_family_daily_attempts`
- `friends_family_daily_results`
- `friends_family_game_attempts`
- `friends_family_game_results`
- `friends_family_sessions`
- `friends_family_users`

This should not be repeated for normal updates.

## Normal Live Update Procedure

For all future code/frontend/backend/script updates, preserve the live Pi data:

```bash
cd /home/chungy/apps
sudo systemctl stop wordbee

timestamp="$(date +%Y%m%d_%H%M%S)"
cp -a wordbee/data "wordbee_data_backup_${timestamp}"
mv wordbee "wordbee_old_${timestamp}"
mkdir wordbee
unzip -q Wordbee.zip -d wordbee
```

If the zip unpacks into `wordbee/Wordbee`, flatten it:

```bash
mv wordbee wordbee_unpack_${timestamp}
mv "wordbee_unpack_${timestamp}/Wordbee" wordbee
```

Restore the live data directory:

```bash
rm -rf wordbee/data
cp -a "wordbee_old_${timestamp}/data" wordbee/data
sudo chown -R chungy:www-data wordbee
sudo chmod -R u+rwX,g+rwX wordbee/data wordbee/frontend/dist
```

Install/update Python dependencies and restart:

```bash
cd /home/chungy/apps/wordbee
scripts/install-pi.sh
sudo systemctl start wordbee
curl http://127.0.0.1:5001/api/health
curl -H "Host: wordbee.matthewbisbee.com" http://localhost/api/health
```

Only reload nginx/cloudflared if their configs changed.

## Schema And Data Migrations

Schema changes must be backward-safe and preserve live data.

Preferred pattern:

- Add tables in `backend/schema.sql` with `CREATE TABLE IF NOT EXISTS`.
- Add indexes with `CREATE INDEX IF NOT EXISTS`.
- Add columns inside `backend/app/db.py:migrate_db()` by checking
  `PRAGMA table_info(...)` before `ALTER TABLE ... ADD COLUMN`.
- Make migrations idempotent so they can run on every app start.

For more complex transformations:

- Write a specific script under `scripts/`.
- Run read-only verification queries first.
- Back up `data/` before writes.
- Use a transaction.
- Run verification queries afterward.

Example live DB safety sequence:

```bash
cd /home/chungy/apps/wordbee
cp -a data "data_backup_$(date +%Y%m%d_%H%M%S)"
sqlite3 data/wordbee.sqlite 'PRAGMA integrity_check;'
# run migration or targeted SQL
sqlite3 data/wordbee.sqlite 'PRAGMA integrity_check;'
sudo systemctl restart wordbee
```

## Targeted Production Data Fixes

Manual DB edits are acceptable for narrow corrections, but always:

- query first
- delete/update by primary key plus extra guard conditions
- verify after
- avoid broad deletes

Example pattern used for removing one fraudulent Wordle result:

```sql
BEGIN;
DELETE FROM friends_family_daily_analysis
WHERE result_id = '<result-id>';

DELETE FROM friends_family_daily_results
WHERE id = '<result-id>'
  AND user_id = '<user-id>'
  AND puzzle_date = 'YYYY-MM-DD'
  AND guesses_used = 1
  AND guesses_json = '["EXACT_GUESS"]';
COMMIT;
```

Stats are computed from result rows when requested. Removing a result row and
its cached analysis makes personal and group stats behave as if the result never
happened. If no attempt row exists, that user can refresh and replay the day on
a clean board.

## Runtime Control Scripts

Maintenance mode:

```bash
cd /home/chungy/apps/wordbee
scripts/maintenance.sh pips on
scripts/maintenance.sh pips off
```

One-day announcement:

```bash
scripts/announcement.sh "Your message here"
scripts/announcement.sh --clear
```

Announcements write `frontend/dist/announcement.json` with today's date and an
expiration timestamp for the next local midnight. The frontend also rejects
stale messages, so they do not reappear the next day.

## Reboot Expectations

These services should be enabled:

```bash
sudo systemctl status wordbee --no-pager
sudo systemctl status nginx --no-pager
sudo systemctl status cloudflared-matthewbisbee --no-pager
```

`wordbee.service` starts Gunicorn after reboot. nginx serves
`frontend/dist` and proxies `/api` to `127.0.0.1:5001`. The Matthew cloudflared
tunnel routes `wordbee.matthewbisbee.com` to local nginx on port 80.
