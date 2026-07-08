#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo."
  exit 2
fi

TARGET_USER="${SUDO_USER:-bulat}"
APP_DIR="${APP_DIR:-/home/$TARGET_USER/apps/health-dashboard}"
SERVICE_FILE="/etc/systemd/system/health-dashboard-scale-bluetooth-watchdog.service"
TIMER_FILE="/etc/systemd/system/health-dashboard-scale-bluetooth-watchdog.timer"

chmod +x "$APP_DIR/deploy/reset-scale-bluetooth.sh"
chmod +x "$APP_DIR/deploy/check-scale-bluetooth.sh"
chmod +x "$APP_DIR/deploy/install-scale-bluetooth-alias.sh"

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Health Dashboard Xiaomi scale Bluetooth watchdog
After=bluetooth.service

[Service]
Type=oneshot
Environment=TARGET_USER=$TARGET_USER
Environment=APP_DIR=$APP_DIR
ExecStart=$APP_DIR/deploy/check-scale-bluetooth.sh
EOF

cat > "$TIMER_FILE" <<EOF
[Unit]
Description=Run Health Dashboard Xiaomi scale Bluetooth watchdog

[Timer]
OnBootSec=2min
OnUnitActiveSec=24h
Persistent=true
Unit=health-dashboard-scale-bluetooth-watchdog.service

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now health-dashboard-scale-bluetooth-watchdog.timer
"$APP_DIR/deploy/install-scale-bluetooth-alias.sh"
systemctl list-timers health-dashboard-scale-bluetooth-watchdog.timer --no-pager
