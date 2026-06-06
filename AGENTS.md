# AGENTS.md

## Communication Style

Avoid contrastive constructions of the form "not A, but B" / "не A, а B", especially as a default explanatory pattern.

Prefer direct affirmative phrasing:

- вместо "это не X, а Y" пиши "это Y"
- вместо "делай не X, а Y" пиши прямую инструкцию с нужным действием
- вместо "проблема не в X, а в Y" пиши "проблема в Y"

Do not overuse rhetorical contrasts. Keep explanations direct and concise.

## Project Context

This repository is a React/Vite life dashboard for personal domains such as health, money, relationships, sport, and other areas over time. The current first domains are health, backed by Xiaomi Body Scale data, money, backed by `Money.md`, and relationships, shown as an in-app counter.

The backend is an Express server in `server/index.ts`; it serves the React app, exposes `/api/health-data` and `/api/status`, receives optional scale measurements through `/api/health-data/measurements`, and broadcasts data updates through `/ws`.

Default runtime settings:

- Port: `5000`
- Local URL: `http://127.0.0.1:5000`
- Default health data directory: `./data/xiaomi-body-scale`
- Default money file: `./data/money/Money.md`

Real paths, names, tokens, bindkeys, hostnames, local IP addresses, and personal exports belong in ignored local config files such as `.env.local` or in deployment-specific environment files.

## Commands

Use these commands from the repository root:

```bash
npm install
npm run dev
npm run build
npm run start
```

`npm run dev` and `npm run start` run `server/index.ts`. `npm run build` runs TypeScript checks and Vite production build.

For LAN access:

```bash
HOST=0.0.0.0 npm run dev
```

For a custom data source:

```bash
HEALTH_DATA_DIR="/path/to/Xiaomi Body Scale" npm run dev
```

For a custom money source:

```bash
MONEY_DATA_FILE="/path/to/Money.md" npm run dev
```

## Xiaomi Scale Automation

The health ingest path supports Xiaomi Body Composition Scale S400 (`MJTZC01YM`, Xiaomi Home model `yunmai.scales.ms104`).

Main components:

- `POST /api/health-data/measurements` in `server/index.ts` receives scale measurements. It is enabled only when `HEALTH_INGEST_TOKEN` is set.
- `server/health-ingest.ts` normalizes payloads, writes `xiaomi-body-scale-data.json`, regenerates `xiaomi-body-scale-measurements.csv` and `xiaomi-body-scale-measurements-long.csv`, and broadcasts a dashboard refresh through WebSocket.
- `scripts/xiaomi-s400-ble-bridge.py` can run as a BLE listener on a local Linux host; it uses `bleak`, `home-assistant-bluetooth`, and `xiaomi-ble` to decode MiBeacon V5 packets with `XIAOMI_SCALE_BINDKEY`.
- `deploy/install-scale-bridge.sh` creates the bridge venv and user systemd unit.
- `requirements-scale-bridge.txt` pins the bridge dependencies. Keep `bleak<1`; `bleak 1.x` breaks the current `home-assistant-bluetooth` / `habluetooth` stack.

The bridge environment contains secrets. Do not print `HEALTH_INGEST_TOKEN` or `XIAOMI_SCALE_BINDKEY` into chat, logs, docs, commits, or final answers. It is fine to report lengths or boolean checks, for example `bindkey_len: 32`.

Useful commands on a deployment host:

```bash
systemctl --user status health-dashboard.service
systemctl --user status xiaomi-scale-bridge.service
journalctl --user -u xiaomi-scale-bridge.service -f
curl -sS http://127.0.0.1:5000/api/status
```

The bridge should log:

```text
Listening for Xiaomi S400 BLE advertisements...
```

The bridge sends a payload after `weight`, `impedance`, and `impedanceLow` are present. It includes `heartRate` and `profile_id` when the BLE update exposes them. It suppresses the same `(profile_id, weight, impedance, impedanceLow)` fingerprint for `21600` seconds.

`server/health-ingest.ts` treats repeated measurements for the same user and weight within 15 minutes as duplicates. If a BLE payload lacks Xiaomi Home full-report fields, the server fills the missing body composition metrics from the user's previous Xiaomi Home full reports using weighted nearest historical reports. These derived fields are marked in source metadata with:

```text
derived_metrics_method=weighted nearest Xiaomi Home full reports
derived_metric_keys=[...]
```

After changing ingest or bridge code, build and verify:

```bash
npm run build
systemctl --user restart health-dashboard.service
systemctl --user restart xiaomi-scale-bridge.service
curl -sS http://127.0.0.1:5000/api/status
```

If the dashboard shows a latest weight timestamp that is newer than latest body fat / water / muscle timestamps, inspect the newest records for incomplete BLE rows, then fix ingestion before accepting the state. A valid latest BLE-ingested row should have roughly 26 metrics.

## Worktrees

Use repository-root `.worktrees/<task-slug>` for future separate worktrees. Use `codex/` as the default branch prefix unless the user asks for another branch name. `.worktrees/` is intentionally ignored by Git.

## Frontend Guidelines

The UI is a dense personal life dashboard. Keep it practical and scan-friendly:

- Use the existing React structure in `src/App.tsx`, chart code in `src/components/HealthChart.tsx`, and global styles in `src/styles.css`.
- Use Lucide icons from `lucide-react` for UI controls and metric tiles.
- Keep cards at `8px` radius unless the existing system changes.
- Keep the current soft life-dashboard palette: blue data, amber active accents, white surfaces, high-contrast text.
- Preserve responsive behavior for desktop and mobile. Check for horizontal page overflow after layout changes.
- Avoid emoji icons, decorative blobs, oversized marketing sections, and low-contrast glass effects.

If UI/UX work is requested, use the local `ui-ux-pro-max` skill first:

```bash
python3 .codex/skills/ui-ux-pro-max/scripts/search.py "personal life dashboard health money relationships sport elegant professional data visualization" --design-system -p "Life Dashboard"
```

## Server Deployment

Deployment hosts should configure environment variables instead of tracked source changes:

```text
PORT=5000
HOST=0.0.0.0
HEALTH_DATA_DIR=/path/to/xiaomi-body-scale
MONEY_DATA_FILE=/path/to/Money.md
HEALTH_INGEST_TOKEN=<stored in a local environment file>
```

After copying server changes, restart the user service and verify:

```bash
curl -sS http://127.0.0.1:5000/api/status
```

Apache reverse proxy is managed by:

```bash
sudo deploy/apache-health-proxy.sh
```

Optional proxy settings:

```bash
SERVER_NAME=health.local SERVER_ALIASES="health health-dashboard.local" sudo -E deploy/apache-health-proxy.sh
```

## Editing Rules

- Keep edits scoped to the requested behavior.
- Do not revert user changes or unrelated files.
- Use structured APIs and existing helpers before adding new parsing or formatting logic.
- Run `npm run build` after code or style changes.
- For significant frontend changes, verify the app in a browser at `http://127.0.0.1:5000`.
