#!/usr/bin/env bash
set -euo pipefail

TARGET_USER="${SUDO_USER:-bulat}"
APP_DIR="${APP_DIR:-/home/$TARGET_USER/apps/health-dashboard}"
ALIAS_FILE="$(getent passwd "$TARGET_USER" | cut -d: -f6)/.bash_aliases"
BASHRC_FILE="$(getent passwd "$TARGET_USER" | cut -d: -f6)/.bashrc"
TARGET_GROUP="$(id -gn "$TARGET_USER")"
ALIAS_LINE="alias blueres='sudo $APP_DIR/deploy/reset-scale-bluetooth.sh'"

touch "$ALIAS_FILE"

TEMP_FILE="$(mktemp)"
grep -v -E "^alias blueres=" "$ALIAS_FILE" > "$TEMP_FILE" || true
printf "%s\n" "$ALIAS_LINE" >> "$TEMP_FILE"
cat "$TEMP_FILE" > "$ALIAS_FILE"
rm -f "$TEMP_FILE"

if ! grep -q ".bash_aliases" "$BASHRC_FILE" 2>/dev/null; then
  cat >> "$BASHRC_FILE" <<'EOF'

if [ -f ~/.bash_aliases ]; then
  . ~/.bash_aliases
fi
EOF
fi

if [ "$(id -u)" -eq 0 ]; then
  chown "$TARGET_USER:$TARGET_GROUP" "$ALIAS_FILE" "$BASHRC_FILE"
fi

echo "Installed alias: blueres -> sudo $APP_DIR/deploy/reset-scale-bluetooth.sh"
