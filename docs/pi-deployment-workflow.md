# Pi Deployment Workflow

This project deploys to the Raspberry Pi as a self-contained `wordbee` app
folder under:

```bash
/home/chungy/apps/wordbee
```

The Pi is the production runtime, not the source of truth. Make code changes in
the local dev checkout, test locally, build a deploy bundle, zip it, and move the
zip to the Pi.

## Agent Quick Start

If another agent is asked to prepare a Pi deploy, assume the following unless the
user explicitly says otherwise:

- Local source of truth: `/Users/matthewbisbee/Documents/Web Dev/Wordle/fnf-wordle`
- Local package root to create: `/Users/matthewbisbee/Documents/Web Dev/Wordle/READY`
- Local zip to transfer: `/Users/matthewbisbee/Documents/Web Dev/Wordle/Wordbee.zip`
- Pi apps directory: `/home/chungy/apps`
- Pi live app directory: `/home/chungy/apps/wordbee`
- Pi live data directory: `/home/chungy/apps/wordbee/data`
- Pi service: `wordbee`
- Pi nginx host: `wordbee.matthewbisbee.com`

Always rebuild `READY` from the dev checkout. Do not trust an existing `READY`
folder; it may have been hand-edited or may contain stale build output. Preserve
the previous `READY` as a timestamped reference if useful, then create a clean
one.

Before giving Pi commands, classify the deploy:

| Deploy Type | Examples | Data Handling |
|---|---|---|
| Code/frontend only | React UI changes, routes, CSS, scripts, requirements | Preserve live `data/`; no SQL writes |
| Additive automatic schema | `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, guarded `ALTER TABLE ADD COLUMN` in `migrate_db()` | Preserve live `data/`; app startup runs migration after backup |
| JSON-in-existing-column stat | New stat stored inside `score_json` or another existing JSON blob | Preserve live `data/`; old rows must default missing keys safely |
| Manual data transformation | Rewriting existing rows, backfilling values, deleting bad rows | Preserve live `data/`; run explicit read-only checks, backup, transaction, verify |
| First launch / reseed | Initial dummy-data scrub only | Special case; do not repeat for normal production updates |

For every deploy, the Pi command sequence must start by zipping the currently
working app folder:

```bash
cd /home/chungy/apps
zip -qry "wordbee_backup_$(date +%Y%m%d_%H%M%S).zip" wordbee
```

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

Use this pattern when `READY` may already exist:

```bash
cd "/Users/matthewbisbee/Documents/Web Dev/Wordle"

timestamp="$(date +%Y%m%d_%H%M%S)"
if [ -e READY ]; then
  mv READY "READY_previous_reference_${timestamp}"
fi

mkdir -p READY/frontend READY/scripts READY/deploy
rsync -a --exclude='__pycache__/' --exclude='*.pyc' fnf-wordle/backend/ READY/backend/
rsync -a fnf-wordle/infra/ READY/deploy/
rsync -a --exclude='dev.mjs' --exclude='__pycache__/' fnf-wordle/scripts/ READY/scripts/
cp fnf-wordle/LICENSE READY/LICENSE
cp fnf-wordle/docs/pi-deployment-workflow.md READY/PI_DEPLOYMENT_WORKFLOW.md

# Carry forward the production env from the previous known-good READY if present.
# If not present, create READY/.env manually from READY/.env.example before deploy.
previous_ready="$(ls -td READY_previous_reference_* 2>/dev/null | head -1 || true)"
if [ -n "$previous_ready" ] && [ -f "$previous_ready/.env" ]; then
  cp "$previous_ready/.env" READY/.env
fi
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

Add a production-focused `.env.example` to the bundle. Keep it free of local
development and archive-fetch settings:

```bash
cat > READY/.env.example <<'EOF'
SECRET_KEY=replace_with_a_long_random_value
WORDBEE_PUZZLE_TIMEZONE=America/Chicago
WORDBEE_FRIENDS_FAMILY_CODES=family:replace_with_family_access_code

WORDBEE_MULTIGAME_WARMUP_ENABLED=1
WORDBEE_MULTIGAME_WARMUP_RETRY_SECONDS=300
WORDBEE_ANNOUNCEMENT_TIMEZONE=America/Chicago

WORDBEE_NTFY_ENABLED=0
WORDBEE_NTFY_BASE_URL=https://ntfy.sh
WORDBEE_NTFY_TOPIC=
WORDBEE_NTFY_ADMIN_TOPIC=
WORDBEE_NTFY_TITLE=Wordbee
WORDBEE_NTFY_TOKEN=
EOF
```

For each release, add a concise `READY/MIGRATION_NOTES.md` that says one of:

- "No manual SQL migration required", with why.
- "Automatic idempotent startup migration", with the exact schema/db files that
  implement it.
- "Manual migration required", with exact read-only checks, backup command,
  transaction, write command, and verification queries.

Package dependency sanity checks:

```bash
grep -q '^gunicorn' READY/backend/requirements.txt
test -x READY/scripts/run-gunicorn.sh
test -x READY/scripts/install-pi.sh
```

The systemd service starts `scripts/run-gunicorn.sh`, which executes
`.venv/bin/gunicorn`. If `gunicorn` is not declared in
`backend/requirements.txt`, `scripts/install-pi.sh` can appear successful while
`wordbee.service` fails with exit status `127`. Keep this dependency explicit
and let `install-pi.sh` fail early if the binary is missing.

Before transferring the zip, verify the archive shape:

```bash
cd "/Users/matthewbisbee/Documents/Web Dev/Wordle/READY"
zip -qr ../Wordbee.zip .
cd ..
tmpdir="$(mktemp -d)"
unzip -q Wordbee.zip -d "$tmpdir"
test -f "$tmpdir/backend/run.py"
test -f "$tmpdir/backend/requirements.txt"
test -f "$tmpdir/frontend/dist/index.html"
test -f "$tmpdir/scripts/install-pi.sh"
test -f "$tmpdir/scripts/run-gunicorn.sh"
test ! -e "$tmpdir/data"
```

Also check that no runtime data or machine cruft slipped into the bundle:

```bash
cd "/Users/matthewbisbee/Documents/Web Dev/Wordle"
find READY -path '*/data/*' -o -name '*.sqlite' -o -name '__pycache__' -o -name '.DS_Store'
zipinfo -1 Wordbee.zip | grep -E '^data/|\.sqlite$|__pycache__|\.DS_Store'
```

Both commands should print nothing. If `zipinfo` shows a removed file after
re-zipping, recreate the zip from scratch instead of updating it in place:

```bash
mv Wordbee.zip "Wordbee_superseded_$(date +%Y%m%d_%H%M%S).zip"
cd READY
zip -qr ../Wordbee.zip .
```

Recommended local verification before transfer:

```bash
cd "/Users/matthewbisbee/Documents/Web Dev/Wordle/fnf-wordle"
npm --prefix frontend run build
python3 -m compileall backend/app scripts
git diff --check
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
- `WORDBEE_PASSWORD_HASH` unless the currently deployed production app already
  uses it

The deployed `.env` usually already exists on the Pi and should be copied forward
from the old app folder during deployment. The `.env` inside `READY` is only a
convenience carried forward from the last known production-ready bundle; the Pi's
currently live `.env` is the most authoritative value during an update.

## Zip Transfer Shape

The preferred zip shape has app files directly at the archive root:

```text
backend/
frontend/dist/
scripts/
deploy/
.env
```

That lets this command create `/home/chungy/apps/wordbee/backend`,
`/home/chungy/apps/wordbee/frontend`, etc. directly:

```bash
unzip -q Wordbee.zip -d wordbee
```

If the zip accidentally unpacks as `wordbee/Wordbee`, flatten it on the Pi:

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

zip -qry "wordbee_backup_$(date +%Y%m%d_%H%M%S).zip" wordbee

cd wordbee
sqlite3 data/wordbee.sqlite 'PRAGMA integrity_check;'
cd ..

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

# The live .env is more authoritative than any bundled .env.
cp -a "wordbee_old_${timestamp}/.env" wordbee/.env

# Preserve current operator controls if they exist. New bundles include default
# inactive JSON files, so missing old files are fine.
if [ -f "wordbee_old_${timestamp}/frontend/dist/maintenance.json" ]; then
  cp -a "wordbee_old_${timestamp}/frontend/dist/maintenance.json" wordbee/frontend/dist/maintenance.json
fi

if [ -f "wordbee_old_${timestamp}/frontend/dist/announcement.json" ]; then
  cp -a "wordbee_old_${timestamp}/frontend/dist/announcement.json" wordbee/frontend/dist/announcement.json
fi

sudo chown -R chungy:www-data wordbee
sudo chmod -R u+rwX,g+rwX wordbee/data wordbee/frontend/dist
```

Install/update Python dependencies and restart:

```bash
cd /home/chungy/apps/wordbee
scripts/install-pi.sh
test -x .venv/bin/gunicorn
sqlite3 data/wordbee.sqlite 'PRAGMA integrity_check;'
sudo systemctl start wordbee
sleep 3
sudo systemctl status wordbee --no-pager
curl http://127.0.0.1:5001/api/health
curl -H "Host: wordbee.matthewbisbee.com" http://localhost/api/health
curl -I -H "Host: wordbee.matthewbisbee.com" http://localhost/
```

Only reload nginx/cloudflared if their configs changed.

## Post-Deploy Health Checks

Run these after every update:

```bash
cd /home/chungy/apps/wordbee
sudo systemctl is-active --quiet wordbee
curl -fsS http://127.0.0.1:5001/api/health
curl -fsS -H "Host: wordbee.matthewbisbee.com" http://localhost/api/health
curl -fsSI -H "Host: wordbee.matthewbisbee.com" http://localhost/
curl -fsS -H "Host: wordbee.matthewbisbee.com" http://localhost/maintenance.json
curl -fsS -H "Host: wordbee.matthewbisbee.com" http://localhost/announcement.json
sqlite3 data/wordbee.sqlite 'PRAGMA integrity_check;'
```

For a broader read-only puzzle smoke test, verify the public daily endpoints
return HTTP 200:

```bash
for path in \
  /api/today \
  /api/games/connections/today \
  /api/games/strands/today \
  /api/games/sudoku/today \
  /api/games/letterboxed/today \
  /api/games/spellingbee/today \
  /api/games/tiles/today \
  /api/games/pips/today \
  /api/games/crossword/today \
  /api/games/mini/today \
  /api/games/midi/today
do
  code="$(curl -sS -o /dev/null -w '%{http_code}' -H "Host: wordbee.matthewbisbee.com" "http://localhost${path}")"
  printf '%s %s\n' "$code" "$path"
done
```

Any `5xx` here is a backend/runtime issue. A `4xx` usually means the endpoint
rejected input or a game key/date is invalid. Check service logs with:

```bash
sudo journalctl -u wordbee -n 120 --no-pager
```

## Schema And Data Migrations

Schema changes must be backward-safe and preserve live data.

Before declaring that a deploy needs a manual migration, inspect the actual diff:

```bash
cd "/Users/matthewbisbee/Documents/Web Dev/Wordle/fnf-wordle"
git diff -- backend/schema.sql backend/app/db.py backend/app/games/*_db.py
rg -n "ALTER TABLE|CREATE TABLE|CREATE INDEX|PRAGMA table_info|score_json|json_extract|migration|migrate_db" backend scripts docs -S
```

No diff in `backend/schema.sql`, `backend/app/db.py`, or the relevant
game-specific `*_db.py` files usually means there is no schema migration. A new
field inside an existing JSON blob, such as a new `score_json` key, is permanent
data but does not require a SQL schema change if all read paths default missing
keys safely.

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

Manual SQL should be the exception. If needed, write the command so it can be
audited before execution, and make it narrow enough to be safe on production
data.

Example live DB safety sequence:

```bash
cd /home/chungy/apps/wordbee
cp -a data "data_backup_manual_migration_$(date +%Y%m%d_%H%M%S)"
sqlite3 data/wordbee.sqlite 'PRAGMA integrity_check;'
# run migration or targeted SQL
sqlite3 data/wordbee.sqlite 'PRAGMA integrity_check;'
sudo systemctl restart wordbee
```

For JSON-in-existing-column stats, use read-only checks rather than schema
writes. Example for a Strands stat stored in `friends_family_game_results.score_json`:

```bash
sqlite3 data/wordbee.sqlite "
SELECT
  count(*) AS strands_rows,
  sum(CASE WHEN json_extract(score_json, '$.hintsUsed') IS NULL THEN 1 ELSE 0 END) AS missing_hints_key
FROM friends_family_game_results
WHERE game_key = 'strands';
"
```

Historical rows missing a new JSON key are acceptable only when the application
explicitly treats missing as the intended default.

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
