#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo or from the root systemd watchdog service."
  exit 2
fi

TARGET_USER="${TARGET_USER:-${SUDO_USER:-bulat}}"
APP_DIR="${APP_DIR:-/home/$TARGET_USER/apps/health-dashboard}"
RESET_SCRIPT="${RESET_SCRIPT:-$APP_DIR/deploy/reset-scale-bluetooth.sh}"
STATE_DIR="${STATE_DIR:-/run/health-dashboard-scale-watchdog}"
COOLDOWN_SECONDS="${COOLDOWN_SECONDS:-900}"
WINDOW="${WINDOW:-10 minutes ago}"

TARGET_UID="$(id -u "$TARGET_USER")"
export XDG_RUNTIME_DIR="/run/user/$TARGET_UID"

mkdir -p "$STATE_DIR"

user_systemctl() {
  sudo -u "$TARGET_USER" XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" systemctl --user "$@"
}

user_journal() {
  sudo -u "$TARGET_USER" XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" journalctl --user "$@"
}

bridge_active="$(user_systemctl is-active xiaomi-scale-bridge.service || true)"
discovering="$(
  busctl get-property org.bluez /org/bluez/hci0 org.bluez.Adapter1 Discovering 2>/dev/null \
    | awk '{print $2}' \
    || true
)"

# Discovering alone can stay true while the controller is wedged. Check errors too.
bridge_errors="$(user_journal -u xiaomi-scale-bridge.service --since "$WINDOW" --no-pager 2>/dev/null | grep -Ec "org.bluez.Error.InProgress|No Bluetooth adapters found|BLE scanner failed" || true)"
kernel_errors="$(journalctl -k --since "$WINDOW" --no-pager 2>/dev/null | grep -Ec "Bluetooth: hci0: command .* tx timeout|Bluetooth: hci0: Unable to disable scanning|Bluetooth: hci0: Opcode .* failed" || true)"

state_file="${BRIDGE_STATE_FILE:-/home/$TARGET_USER/.local/state/health-dashboard/scale-bridge.json}"
state_healthy="$(python3 - "$state_file" <<'PY_STATE'
import json, pathlib, sys, time
p = pathlib.Path(sys.argv[1])
try:
    r = json.loads(p.read_text())
    print("yes" if time.time() - float(r.get("heartbeat_at", 0)) < 120 else "no")
except FileNotFoundError:
    print("yes")  # Compatibility with bridges installed before persistent state.
except (ValueError, OSError, TypeError):
    print("no")
PY_STATE
)"

unhealthy_file="$STATE_DIR/unhealthy-since"
now="$(date +%s)"
# Ignore old journal errors after a successful reset.
last_reset=0
if [ -s "$STATE_DIR/last-reset" ]; then
  last_reset="$(cat "$STATE_DIR/last-reset")"
fi
if [ "$bridge_active" = "active" ] && [ "$discovering" = "true" ] && [ "$state_healthy" = "yes" ] && {
  [ "$bridge_errors" -lt 3 ] && [ "$kernel_errors" -eq 0 ] || [ "$((now - last_reset))" -lt 600 ];
}; then
  rm -f "$unhealthy_file"
  echo "Xiaomi scale Bluetooth watchdog: healthy."
  exit 0
fi

if [ ! -s "$unhealthy_file" ]; then
  echo "$now" > "$unhealthy_file"
fi
unhealthy_since="$(cat "$unhealthy_file")"
if [ "$bridge_active" != "active" ]; then
  user_systemctl reset-failed xiaomi-scale-bridge.service || true
  user_systemctl start xiaomi-scale-bridge.service || true
fi
# Also recover silent stalls without recognizable journal errors, after two checks.
if [ "$bridge_errors" -lt 3 ] && [ "$kernel_errors" -eq 0 ] && [ "$((now - unhealthy_since))" -lt 120 ]; then
  echo "Xiaomi scale Bluetooth watchdog: waiting for scan recovery."
  exit 0
fi

last_reset_file="$STATE_DIR/last-reset"
now="$(date +%s)"
last_reset=0
if [ -s "$last_reset_file" ]; then
  last_reset="$(cat "$last_reset_file" 2>/dev/null || echo 0)"
fi

if [ "$((now - last_reset))" -lt "$COOLDOWN_SECONDS" ]; then
  echo "Xiaomi scale Bluetooth watchdog: reset cooldown active. bridge_errors=$bridge_errors kernel_errors=$kernel_errors"
  exit 0
fi

echo "$now" > "$last_reset_file"
echo "Xiaomi scale Bluetooth watchdog: resetting hci0. bridge_errors=$bridge_errors kernel_errors=$kernel_errors"
TARGET_USER="$TARGET_USER" "$RESET_SCRIPT"
