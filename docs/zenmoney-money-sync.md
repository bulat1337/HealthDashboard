# ZenMoney Money Sync

This workflow updates the money section of the dashboard from ZenMoney accounts.

Data flow:

```text
Bank apps -> ZenMoney mobile sync -> ZenMoney API -> VaioServer HealthDashboard -> Money.md -> WebSocket refresh
```

## Why This Exists

The dashboard still reads `Money.md`. In production, the Express server runs the sync script, updates `Money.md`, refreshes its cache, and broadcasts a `money-data-updated` WebSocket event.

## Local Files

Runtime files live outside the repository. On a deployment host, prefer deployment-specific paths such as:

```text
/home/<user>/.config/health-dashboard/zenmoney-token.json
/home/<user>/.config/health-dashboard/zenmoney-money-sync-config.json
/home/<user>/.local/state/health-dashboard/zenmoney-money-sync-status.json
```

The local development defaults are:

```text
~/.codex/state/health-dashboard-money-sync/zenmoney-token.json
~/.codex/state/health-dashboard-money-sync/zenmoney-money-sync-config.json
~/.codex/state/health-dashboard-money-sync/zenmoney-money-sync-status.json
~/.codex/state/health-dashboard-money-sync/logs/
```

The token file contains ZenMoney OAuth tokens and must stay local.

## Server Setup

The deployment service environment should point the dashboard at the real data paths and enable server-side sync:

```bash
MONEY_DATA_FILE="/path/to/Money.md"
MONEY_PARTNER_LABEL="партнера"
HEALTH_DEFAULT_TIMEZONE="Europe/Moscow"
MONEY_SYNC_ENABLED="true"
MONEY_SYNC_TIMEZONE="Europe/Moscow"
MONEY_SYNC_START_HOUR=8
MONEY_SYNC_END_HOUR=23
MONEY_SYNC_FINAL_MINUTE=30
ZENMONEY_TOKEN_FILE="/home/<user>/.config/health-dashboard/zenmoney-token.json"
ZENMONEY_MONEY_SYNC_CONFIG="/home/<user>/.config/health-dashboard/zenmoney-money-sync-config.json"
MONEY_SYNC_STATE_DIR="/home/<user>/.local/state/health-dashboard"
# Optional: trigger ZenMoney mobile app sync before reading ZenMoney API.
ZENMONEY_PRE_SYNC_URL="http://phone-or-automation-host/sync-zenmoney"
ZENMONEY_PRE_SYNC_TOKEN="<stored in local environment file>"
ZENMONEY_PRE_SYNC_WAIT_MS=45000
```

Create the sync config on the machine that will run the server:

```bash
npm run money:zenmoney:init
```

This writes:

```text
~/.codex/state/health-dashboard-money-sync/zenmoney-money-sync-config.json
```

Re-run with `-- --force` only when you intentionally want to replace the local config.

After ZenMoney authorization, inspect the available accounts on the server:

```bash
npm run money:zenmoney:accounts
```

If ZenMoney contains extra accounts, edit the server config and fill `includeAccountIds`, `excludeAccountIds`, `investmentAccountIds`, `excludeInvestmentAccountIds`, `creditCardAccountIds`, or `excludeCreditCardAccountIds`.

## Authorization

### Option A: Token From Zerro

ZenMoney's API documentation says a personal API token can be obtained through a registered service such as Zerro.app.

1. Open [Zerro token page](https://zerro.app/token).
2. Sign in to ZenMoney.
3. Copy only the token JSON or the raw token string from the page. Do not copy terminal commands or surrounding explanatory text.
4. Import it on VaioServer:

```bash
pbpaste | npm run money:zenmoney:import-token -- -
```

The importer accepts either token JSON with `access_token` or a single raw access token string. If JSON also includes `refresh_token`, the script can refresh the token when OAuth client credentials are configured.

### Option B: Own OAuth Client

Set these in the server environment:

```bash
ZENMONEY_CLIENT_ID="..."
ZENMONEY_CLIENT_SECRET="..."
ZENMONEY_REDIRECT_URI="http://127.0.0.1:53682/callback"
```

Then run:

```bash
npm run money:zenmoney:auth-server
```

The script opens ZenMoney authorization in the browser, receives the callback, and saves the token file.

## Test Before Writing

Preview the row:

```bash
npm run money:zenmoney:dry-run
```

Write or update today's row:

```bash
npm run money:zenmoney:write
```

The command is idempotent for a date: if today's row already exists, it updates that row.

## Server Refresh

Manual refresh through the server API:

```bash
curl -X POST http://127.0.0.1:5000/api/money-data/refresh
```

The dashboard refresh button calls this endpoint when the active tab is `Деньги`.

This endpoint reads ZenMoney API data. If `ZENMONEY_PRE_SYNC_URL` or `ZENMONEY_PRE_SYNC_COMMAND` is set, the script first asks the phone automation to start ZenMoney mobile sync, waits `ZENMONEY_PRE_SYNC_WAIT_MS`, then reads `/v8/diff/`.

## Schedule

In production, `server/index.ts` schedules sync runs inside the Express process. Defaults:

```text
08:00, 09:00, 10:00, ..., 23:00, 23:30
```

Check status on the deployment host:

```bash
curl -sS http://127.0.0.1:5000/api/status
cat /home/<user>/.local/state/health-dashboard/zenmoney-money-sync-status.json
journalctl --user -u health-dashboard.service -n 80
```

## Calculation Rules

The script mirrors the current `Money.md` rules:

- liquid debit total comes from active ZenMoney accounts with types `cash`, `checking`, `deposit`, `emoney`, plus ordinary `ccard` bank cards without a credit limit;
- investment total comes from configured investment accounts; by default this matches T-Bank broker accounts whose title contains `брокер`;
- total money is `liquid debit total + investment total`;
- credit-card debt comes from active card accounts with `creditLimit > 0` or negative balance as `max(0, -balance)`;
- required credit-card groups default to Alfa and T-Bank;
- all participants’ credit-card debt comes from the selected ZenMoney accounts; legacy manual debt labels are ignored;
- separate personal savings are configured by the `Начало раздельного учёта` label, participant table (`Базовые накопления`) and transition table (`Правило пополнения`);
- participant rows define monthly income, monthly savings, two salary days and starting savings; transition rows override a salary date with a fixed contribution, including zero for a skipped date;
- contributions are rounded to whole rubles; Diana’s contribution on 15 October 2026 is zero, with subsequent contributions fixed at 20,000 ₽. Her actual savings are corrected in the ordinary snapshot editor;
- contributions since the latest separate-savings snapshot are carried forward, including missed refresh dates; an existing same-day snapshot is reused so repeats do not add savings twice;
- a manual savings edit is saved as a dated balance in Money.md. An edit one or two calendar days before a positive scheduled contribution handles that contribution early; its scheduled date adds nothing. Later contributions resume normally, independently for each participant;
- only fields whose values actually changed create manual adjustments. Repeated saves, full snapshot submissions and restarts preserve the saved adjustments;
- retroactive transition entries before the split date are added once to starting savings; old reserve snapshots keep their original values;
- rent defaults to unpaid from the 10th through the 18th, inclusive. A manual rent status takes precedence from the edited snapshot date through that calendar month, until another manual status is saved; the following month returns to the default calendar;
- shared budget is `liquid debit total - credit-card debt - unpaid rent - personal savings of both participants`; money already moved into personal savings is never separately subtracted again;
- a salary day of 30 falls on the last day of February;
- files without a savings plan retain the legacy reserve/partner-money calculation. Malformed plans produce an error instead of silently using the legacy rules.

The server and CLI share `scripts/money-rules.mjs`. The web record editor also preserves the investment rule: changing investments changes total assets by the same delta and leaves the shared budget unchanged. New snapshots require readable savings, investments, debt and total assets. Historical snapshots remain editable under their original rules.

Manual adjustments are stored in a `money-manual-adjustments` HTML comment inside Money.md, alongside its snapshots. The API and ZenMoney sync read the same metadata. Savings calculations start from the latest manual balance for each participant and add subsequent unhandled contributions, so later automatic snapshots cannot undo a manual correction. Account balances, investments and credit-card debt continue to update from ZenMoney.

Currency conversion uses ZenMoney `Instrument.rate`, which is defined as the currency value in rubles.

## Limitations

ZenMoney mobile bank connections are stored on the phone. The public ZenMoney API used here synchronizes ZenMoney account data and does not expose a server-side command for starting those mobile bank connections. A one-button dashboard refresh therefore needs a phone-side automation trigger that performs the same ZenMoney mobile sync action currently done manually.
