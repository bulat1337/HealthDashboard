# AGENTS.md

## Communication Style

Avoid contrastive constructions of the form "not A, but B" / "не A, а B", especially as a default explanatory pattern. Use them only when the contrast is genuinely important for correctness.

Prefer direct affirmative phrasing:

- вместо "это не X, а Y" пиши "это Y"
- вместо "делай не X, а Y" пиши прямую инструкцию с нужным действием
- вместо "проблема не в X, а в Y" пиши "проблема в Y"

Do not overuse rhetorical contrasts. Keep explanations direct and concise.

## Project Context

This repository is a local React/Vite health dashboard for Xiaomi Body Scale data. The backend is an Express server in `server/index.ts`; it serves the React app, exposes `/api/health-data` and `/api/status`, and broadcasts data updates through `/ws`.

Default runtime settings:

- Port: `5000`
- Local URL: `http://127.0.0.1:5000`
- Server URL: `http://192.168.31.74:5000`
- Default data directory on macOS: `/Users/bulatmotygullin/Documents/Obsidian_Vault/007 - Shelf/Health/Xiaomi Body Scale`
- Default data directory on VaioServer: `/home/bulat/data/health-dashboard/xiaomi-body-scale`

For Obsidian Vault-specific workflows, including Xiaomi Home smart scale export, see `/Users/bulatmotygullin/Documents/Obsidian_Vault/AGENTS.md`.

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

## Frontend Guidelines

The UI is a dense health dashboard. Keep it practical and scan-friendly:

- Use the existing React structure in `src/App.tsx`, chart code in `src/components/HealthChart.tsx`, and global styles in `src/styles.css`.
- Use Lucide icons from `lucide-react` for UI controls and metric tiles.
- Keep cards at `8px` radius unless the existing system changes.
- Keep the current soft health-dashboard palette: blue data, amber active accents, white surfaces, high-contrast text.
- Preserve responsive behavior for desktop and mobile. Check for horizontal page overflow after layout changes.
- Avoid emoji icons, decorative blobs, oversized marketing sections, and low-contrast glass effects.

If UI/UX work is requested, use the local `ui-ux-pro-max` skill first:

```bash
python3 .codex/skills/ui-ux-pro-max/scripts/search.py "healthcare health metrics dashboard elegant professional data visualization" --design-system -p "Health Dashboard"
```

## Server Deployment

The deployed app lives on `VaioServer`:

```bash
ssh VaioServer
cd /home/bulat/apps/health-dashboard
```

The app runs as a user systemd service:

```bash
systemctl --user status health-dashboard.service
systemctl --user restart health-dashboard.service
systemctl --user status health-dashboard-mdns.service
```

Expected service environment includes:

```text
PORT=5000
HOST=0.0.0.0
HEALTH_DATA_DIR=/home/bulat/data/health-dashboard/xiaomi-body-scale
```

After copying server changes, restart the user service and verify:

```bash
curl -sS http://127.0.0.1:5000/api/status
curl -sS http://192.168.31.74:5000/api/status
```

Apache reverse proxy is managed by:

```bash
sudo /home/bulat/apps/health-dashboard/deploy/apache-health-proxy.sh
```

This requires sudo on `VaioServer`. The proxy should point `/` and `/ws` to `127.0.0.1:5000`.

## Editing Rules

- Keep edits scoped to the requested behavior.
- Do not revert user changes or unrelated files.
- Use structured APIs and existing helpers before adding new parsing or formatting logic.
- Run `npm run build` after code or style changes.
- For significant frontend changes, verify the app in a browser at `http://127.0.0.1:5000`.
