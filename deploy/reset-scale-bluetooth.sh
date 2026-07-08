#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo."
  exit 2
fi

TARGET_USER="${SUDO_USER:-bulat}"
TARGET_UID="$(id -u "$TARGET_USER")"
export XDG_RUNTIME_DIR="/run/user/$TARGET_UID"

user_systemctl() {
  sudo -u "$TARGET_USER" XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" systemctl --user "$@"
}

echo "Stopping Xiaomi scale bridge..."
user_systemctl stop xiaomi-scale-bridge.service || true

echo "Stopping bluetooth.service..."
systemctl stop bluetooth.service || true

USB_DEVICE=""
if [ -e /sys/class/bluetooth/hci0/device ]; then
  HCI_DEVICE_PATH="$(readlink -f /sys/class/bluetooth/hci0/device)"
  USB_INTERFACE="$(basename "$HCI_DEVICE_PATH")"
  USB_DEVICE="${USB_INTERFACE%%:*}"
fi

if command -v hciconfig >/dev/null 2>&1; then
  timeout 8 hciconfig hci0 down || true
fi

if [ -n "$USB_DEVICE" ]; then
  echo "Resetting btusb interfaces for $USB_DEVICE..."
  mapfile -t BTUSB_INTERFACES < <(
    find /sys/bus/usb/drivers/btusb -maxdepth 1 -type l -name "$USB_DEVICE:*" -printf "%f\n" 2>/dev/null | sort
  )

  for interface in "${BTUSB_INTERFACES[@]}"; do
    echo "$interface" > /sys/bus/usb/drivers/btusb/unbind || true
  done

  sleep 3

  for interface in "${BTUSB_INTERFACES[@]}"; do
    echo "$interface" > /sys/bus/usb/drivers/btusb/bind || true
  done
else
  echo "hci0 sysfs device was not found; reloading btusb module."
  modprobe -r btusb || true
  sleep 3
  modprobe btusb
fi

sleep 3

echo "Starting bluetooth.service..."
systemctl start bluetooth.service
sleep 5

if command -v bluetoothctl >/dev/null 2>&1; then
  bluetoothctl show || true
fi

echo "Starting Xiaomi scale bridge..."
user_systemctl start xiaomi-scale-bridge.service
sleep 5
user_systemctl status xiaomi-scale-bridge.service --no-pager || true
