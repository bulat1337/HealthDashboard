# Maintenance audit — 2026-09-05

The scale receiver was repeatedly restarting after BlueZ controller scan failures. The existing watchdog ran once daily and could incorrectly accept an active discovery flag despite repeated errors. Historical scale results were also rebroadcast every six hours as newly timestamped measurements.

Implemented fixes:

- Controller watchdog every two minutes, stale heartbeat and persistent scan failure checks, root-owned recovery scripts, USB wake/reset and cooldown.
- Fresh S400 fragment pairing by device/profile/raw timestamp using the existing authenticated decoder. Persistent HTTP outbox; delivery acknowledged before duplicate suppression; suppression survives process restarts and has no six-hour expiry.
- Server duplicate detection by source identity, original timestamp and unchanged latest legacy dual-impedance fingerprint. Historical cleanup preserves original JSON backups and rebuilds both CSV exports. The cleanup removed 80 legacy repetitions from 151 records.
- Ingest validation of users, weights, timestamps and timezones; supplied full-report metrics preserved; derived values can only be replaced by measured values. All newly estimated/computed fields retain provenance metadata.
- Atomic, flushed data-file writes; server stays available when the health file is missing at startup. File watches cover sport updates and use independent debouncing. API paths return JSON 404 responses, prohibit cross-origin writes and disable caching.
- Browser refresh after websocket reconnection and page visibility restoration; stale concurrent loads ignored; chart hover resets when switching data. Calendar-day relationship counts remain correct across daylight saving changes.
- Money API deadlines and bounded authentication retry; missing selected balances/rates fail validation; excluded investment accounts stay excluded; date validation and rent cutoff corrected. Sync reads the local money file after remote fetching and checks for conflicting edits before atomic replacement. ZenMoney debit cards continue to be supported (`ccard` means bank card).
- Dependency patch updates eliminate six reported npm audit findings.
- LAN reverse proxy points to the application port. The optional HTTP-only installation preserves Tailscale HTTPS and refuses to disable TLS for enabled Apache TLS sites.

Validation: 14 Node/TypeScript tests, four Python bridge tests (including the real installed Xiaomi parser with synthetic frames), TypeScript check, production build, dependency audit, live server/API checks and browser checks. Test writes use isolated files; the production replay uses an existing historical measurement. JSON and wide CSV both contain 71 canonical rows after cleanup.

Limitations: the scale's raw timestamp is an opaque measurement identity until its clock semantics are verified on real packets. Identical legacy consecutive results without an identity are indistinguishable. BLE-derived composition values remain estimates based on prior full reports; a newly completed physical weighing is needed to confirm the entire radio-to-chart path after recovery.

Decoder reference: https://github.com/Bluetooth-Devices/xiaomi-ble/blob/main/src/xiaomi_ble/parser.py

Money API reference: https://github.com/zenmoney/ZenPlugins/wiki/ZenMoney-API
