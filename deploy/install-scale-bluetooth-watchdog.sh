#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo."
  exit 2
fi

TARGET_USER="${TARGET_USER:-${SUDO_USER:-bulat}}"
APP_DIR="${APP_DIR:-/home/$TARGET_USER/apps/health-dashboard}"
SERVICE_FILE="/etc/systemd/system/health-dashboard-scale-bluetooth-watchdog.service"
TIMER_FILE="/etc/systemd/system/health-dashboard-scale-bluetooth-watchdog.timer"

# Root services execute root-owned copies; application deployments cannot replace them.
LIBEXEC_DIR="/usr/local/libexec/health-dashboard"
install -d -m 755 "$LIBEXEC_DIR"
install -m 755 "$APP_DIR/deploy/check-scale-bluetooth.sh" "$LIBEXEC_DIR/check-scale-bluetooth.sh"
install -m 755 "$APP_DIR/deploy/reset-scale-bluetooth.sh" "$LIBEXEC_DIR/reset-scale-bluetooth.sh"

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Health Dashboard Xiaomi scale Bluetooth watchdog
After=bluetooth.service

[Service]
Type=oneshot
Environment=TARGET_USER=$TARGET_USER
Environment=APP_DIR=$APP_DIR
Environment=RESET_SCRIPT=$LIBEXEC_DIR/reset-scale-bluetooth.sh
ExecStart=$LIBEXEC_DIR/check-scale-bluetooth.sh
TimeoutStartSec=120
EOF

cat > "$TIMER_FILE" <<EOF
[Unit]
Description=Run Health Dashboard Xiaomi scale Bluetooth watchdog

[Timer]
OnBootSec=2min
OnUnitActiveSec=2min
AccuracySec=10s
Persistent=true
Unit=health-dashboard-scale-bluetooth-watchdog.service

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable health-dashboard-scale-bluetooth-watchdog.timer
systemctl restart health-dashboard-scale-bluetooth-watchdog.timer
systemctl start health-dashboard-scale-bluetooth-watchdog.service
bash "$APP_DIR/deploy/install-scale-bluetooth-alias.sh"
systemctl list-timers health-dashboard-scale-bluetooth-watchdog.timer --no-pager
