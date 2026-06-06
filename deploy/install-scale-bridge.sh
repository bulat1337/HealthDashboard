#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/apps/health-dashboard}"
CONFIG_DIR="${CONFIG_DIR:-$HOME/.config/health-dashboard}"
SERVICE_DIR="${SERVICE_DIR:-$HOME/.config/systemd/user}"
ENV_FILE="$CONFIG_DIR/xiaomi-scale-bridge.env"
TOKEN_FILE="$CONFIG_DIR/health-ingest-token"
VENV_DIR="$APP_DIR/.venv-scale-bridge"

cd "$APP_DIR"

VENV_CHECK_DIR="$(mktemp -d)"
if ! python3 -m venv "$VENV_CHECK_DIR/test-venv" >/dev/null 2>&1; then
  rm -rf "$VENV_CHECK_DIR"
  echo "python3 venv support is missing. Run:"
  echo "  sudo apt update && sudo apt install -y python3-venv python3-pip bluez"
  exit 2
fi
rm -rf "$VENV_CHECK_DIR"

if ! command -v bluetoothctl >/dev/null 2>&1; then
  echo "bluez is missing. Run:"
  echo "  sudo apt update && sudo apt install -y bluez"
  exit 2
fi

if [ ! -s "$TOKEN_FILE" ]; then
  echo "Missing ingest token at $TOKEN_FILE. Enable dashboard ingest first."
  exit 2
fi

python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/python" -m pip install --upgrade pip
"$VENV_DIR/bin/python" -m pip install -r "$APP_DIR/requirements-scale-bridge.txt"

mkdir -p "$CONFIG_DIR" "$SERVICE_DIR"
chmod 700 "$CONFIG_DIR"

if [ ! -f "$ENV_FILE" ]; then
  umask 077
  cat > "$ENV_FILE" <<EOF
HEALTH_INGEST_TOKEN=$(cat "$TOKEN_FILE")
HEALTH_DASHBOARD_INGEST_URL=http://127.0.0.1:5000/api/health-data/measurements
XIAOMI_SCALE_BINDKEY=
XIAOMI_SCALE_ADDRESS=
XIAOMI_SCALE_MIN_REPEAT_SECONDS=21600
XIAOMI_SCALE_SETTLE_SECONDS=6
XIAOMI_SCALE_PENDING_TTL_SECONDS=90
EOF
fi

cat > "$SERVICE_DIR/xiaomi-scale-bridge.service" <<EOF
[Unit]
Description=Xiaomi S400 BLE bridge for Health Dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$VENV_DIR/bin/python $APP_DIR/scripts/xiaomi-s400-ble-bridge.py
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload

echo "Bridge service installed."
echo "Fill XIAOMI_SCALE_BINDKEY in $ENV_FILE, then run:"
echo "  systemctl --user enable --now xiaomi-scale-bridge.service"
echo "  journalctl --user -u xiaomi-scale-bridge.service -f"
