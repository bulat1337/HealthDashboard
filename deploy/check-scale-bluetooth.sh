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

if [ "$bridge_active" = "active" ] && [ "$discovering" = "true" ]; then
  echo "Xiaomi scale Bluetooth watchdog: healthy."
  exit 0
fi

bridge_errors="$(
  user_journal -u xiaomi-scale-bridge.service --since "$WINDOW" --no-pager 2>/dev/null \
    | grep -Ec "org.bluez.Error.InProgress|No Bluetooth adapters found|BLE scanner failed repeatedly" \
    || true
)"
kernel_errors="$(
  journalctl -k --since "$WINDOW" --no-pager 2>/dev/null \
    | grep -Ec "Bluetooth: hci0: command 0x200c tx timeout|Bluetooth: hci0: Unable to disable scanning|Bluetooth: hci0: Opcode 0x200c failed" \
    || true
)"

if [ "$bridge_active" != "active" ] && [ "$bridge_errors" -eq 0 ] && [ "$kernel_errors" -eq 0 ]; then
  echo "Xiaomi scale bridge is $bridge_active; starting user service."
  user_systemctl start xiaomi-scale-bridge.service || true
  exit 0
fi

if [ "$bridge_errors" -eq 0 ] && [ "$kernel_errors" -eq 0 ]; then
  echo "Xiaomi scale Bluetooth watchdog: no recent scan errors. bridge=$bridge_active discovering=${discovering:-unknown}"
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
"$RESET_SCRIPT"
