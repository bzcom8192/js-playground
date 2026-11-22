# Semicolon Acres Online server: install and update

One Node process serves the built game (`dist/`) and the JSON API (`/api/…`) on one port, with one SQLite file. The production model is the same as money-app: a systemd service listening on localhost, and Apache in front as the public HTTPS reverse proxy.

```
browser ──HTTPS──> Apache (public name) ──HTTP──> 127.0.0.1:4188 node server/index.js ──> farmer-online.db
```

| file | what it is |
|---|---|
| `server/index.js` | entry point (`npm run server`) |
| `server/deploy/farmer-server.service` | systemd unit |
| `server/deploy/apache-vhost.example.conf` | Apache vhost |

Examples below use `/opt/js-farmer` for the checkout, `/var/lib/js-farmer` for the data, `farmer` for the service user and `farmer.example.com` for the public name. Change them to your own, in the unit and the vhost too.

## Settings (environment)

| variable | default | |
|---|---|---|
| `PORT` | `4188` | port |
| `HOST` | `127.0.0.1` | listen address. Keep it on localhost in production; `0.0.0.0` listens on every interface |
| `FARMER_DB` | `server/data/farmer-online.db` | DB file. The unit sets `/var/lib/js-farmer/farmer-online.db`. Missing directories are created |
| `FARMER_DIST` | `dist/` | the built game |
| `TRUST_PROXY` | off | `1`: take the visitor address for the rate limit from `X-Forwarded-For` (only behind a proxy that overwrites it, as the example vhost does) |
| `RATE_LIMIT` | `60` | writes per minute per player token (per address without a valid token) |
| `VERIFY_TIMEOUT_MS` | `10000` | time limit of one replay |
| `VERIFY_WORKERS` | `2` | replays at the same time |
| `FARMER_SECRET` | a random one, made once and kept in the DB | what the hidden mazes of the maze leaderboard are derived from (at least 16 characters). Setting or changing it changes the current week's maze |

## Install

### 1. Prerequisites
- **Node 22.15 or newer** (24 recommended), installed system-wide. `node:sqlite` and `module.registerHooks` need it. Check with `node -v`.
  - The unit uses `/usr/bin/node`. If `command -v node` says something else, change `ExecStart`.
  - A Node under `/home` (nvm) does not work: the unit hides `/home` (`ProtectHome`).
- Apache 2.4 and git. The `sqlite3` command is optional (live backups).
- The **server has no npm dependencies**. `npm ci` is only needed to build the game.

### 2. Checkout and build
As your own (deploy) user, not as `farmer`:
```bash
sudo install -d -o "$USER" /opt/js-farmer
git clone -b farmer-game <repo-url> /opt/js-farmer
cd /opt/js-farmer
npm ci --include=dev     # vite is a dev dependency
npm run build            # → dist/
```
The service user only needs to *read* the checkout.

### 3. User and data directory
```bash
sudo useradd --system --home-dir /var/lib/js-farmer --shell /usr/sbin/nologin farmer
sudo install -d -o farmer -g farmer -m 0750 /var/lib/js-farmer
```
(systemd also creates the directory by itself: `StateDirectory=js-farmer`.)

### 4. Service
```bash
sudo cp server/deploy/farmer-server.service /etc/systemd/system/
sudo nano /etc/systemd/system/farmer-server.service     # user, paths, node
sudo systemd-analyze verify /etc/systemd/system/farmer-server.service
sudo systemctl daemon-reload
sudo systemctl enable --now farmer-server
```

### 5. Health check
```bash
curl http://127.0.0.1:4188/api/health        # {"ok":true}
systemctl status farmer-server
journalctl -u farmer-server -n 50            # "Semicolon Acres Online listening on http://127.0.0.1:4188 (db …)"
```

### 6. Apache
```bash
sudo a2enmod ssl proxy proxy_http headers
sudo cp server/deploy/apache-vhost.example.conf /etc/apache2/sites-available/js-farmer.conf
sudo nano /etc/apache2/sites-available/js-farmer.conf    # name (4 places + certificate paths)
sudo a2ensite js-farmer
sudo apache2ctl configtest && sudo systemctl reload apache2
curl https://farmer.example.com/api/health               # {"ok":true}
```
The certificate must exist before the site is enabled (`configtest` fails otherwise). The game itself is at `https://farmer.example.com/#/farmer`.

## Update
Pull, build, restart. Note the current commit first, for a rollback, and back up the DB (below).
```bash
cd /opt/js-farmer
git rev-parse HEAD | tee ~/js-farmer-previous
git pull --ff-only
npm ci --include=dev
npm run build
sudo systemctl restart farmer-server
curl http://127.0.0.1:4188/api/health
```
- The DB file is upgraded in place on start (columns and indexes are only ever added).
- `npm run build` empties `dist/` while it runs. For those seconds a fresh page load can fail, and open tabs may need a reload afterwards.
- If `server/deploy/farmer-server.service` changed, copy it again, then `sudo systemctl daemon-reload`.

## Rollback
Back to the previous checkout; the DB stays where it is.
```bash
cd /opt/js-farmer
git checkout "$(cat ~/js-farmer-previous)"
npm ci --include=dev && npm run build
sudo systemctl restart farmer-server
```
To go forward again: `git checkout farmer-game`, then Update.
- A v4 server (phase 2) runs fine on a DB that v5 has opened: the new columns are nullable, and v5 fills in the rows a v4 server added. The v4 server does not know about challenge expiry, so expired challenges are open again while it runs.
- A server from before the hidden weekly maze runs on this DB too: it ignores the column `period`, and the maze scores it stores count as legacy after the next update.
- A v5 server from before the daily race ignores its entries (column `race_date`); they are back after the next update.
- Going back further than that has not been tested.

## Database and backup
Everything the server stores is in **one SQLite file**, `/var/lib/js-farmer/farmer-online.db`: players (only token *hashes*), scores, challenges and results. While the server runs, two helper files are next to it (`-wal`, `-shm`), so don't copy just the `.db` of a running server.

```bash
sudo install -d -o farmer -g farmer -m 0750 /var/backups/js-farmer

# running server: sqlite's online backup
sudo -u farmer sqlite3 /var/lib/js-farmer/farmer-online.db ".backup '/var/backups/js-farmer/farmer-$(date +%F).db'"

# or stopped: a plain copy of the one file (a clean stop folds -wal into it)
sudo systemctl stop farmer-server
sudo cp /var/lib/js-farmer/farmer-online.db /var/backups/js-farmer/farmer-$(date +%F).db
sudo systemctl start farmer-server
```
If a `-wal` file is still there after a stop (it was killed), copy it together with the `.db`.

Restore:
```bash
sudo systemctl stop farmer-server
sudo rm -f /var/lib/js-farmer/farmer-online.db-wal /var/lib/js-farmer/farmer-online.db-shm
sudo install -o farmer -g farmer -m 0640 /var/backups/js-farmer/farmer-2026-11-22.db /var/lib/js-farmer/farmer-online.db
sudo systemctl start farmer-server
```
Players keep their identity as long as the DB has their token hash. A lost DB means everyone has to join again.

## Development (buildbox, bore)
```bash
npm run build && npm run server           # http://127.0.0.1:4188
bore local 4188 --to <bore-server>        # forwards to localhost:4188
```
- The server listens on `127.0.0.1` only. **bore needs nothing more:** it connects to `localhost:4188` from the same machine. `npm run dev` (Vite) proxies `/api` there too.
- To reach it directly from another machine (LAN, Tailscale): `HOST=0.0.0.0 npm run server`.
- Port 4188 must be free. A `python3 -m http.server 4188` that still serves the old static build has to be stopped first (`ss -ltnp | grep 4188`), or use another `PORT`.

## Daily maze race
The race date is the Bangkok calendar date, computed from the server clock (the time zone setting of the machine does not matter). Keep the clock synchronised (`timedatectl`): a wrong clock means the wrong course. There is nothing to schedule; a new day starts by itself.

## Maze leaderboard
Everybody's maze program runs on a hidden 12×12 maze that only the server knows, one per level and Bangkok ISO week (a new one every Monday 00:00 Bangkok time). Its seed is derived from the server secret, is never stored with the scores and never sent out. Nothing has to be scheduled.
- The secret is in the DB (table `settings`), so **a backup of the DB contains it**: whoever has it can work out the mazes. Keep backups private. A restored backup keeps the same mazes; a new DB gets new ones.
- Scores from before this rule have no `period`. They stay in the table and on the board, unranked and marked as legacy.

## Troubleshooting
- **Apache answers 503:** the service is not running, or not on the port in `ProxyPass` (`systemctl status farmer-server`).
- **The game says "เซิร์ฟเวอร์ไม่ตอบสนอง":** open `/api/health` in the browser. It must be `{"ok":true}`.
- **`the game is not built yet`:** run `npm run build` in the checkout.
- **`unable to open database file` / `readonly database`:** `FARMER_DB` is not inside `StateDirectory`, or the file is not owned by `farmer`.
- **`Cannot find module` / exits at once:** `WorkingDirectory` is wrong, the checkout is under `/home`, or `farmer` may not read it.
- **`EADDRINUSE`:** something else has the port.
