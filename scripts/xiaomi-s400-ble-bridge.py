#!/usr/bin/env python3
"""Bridge Xiaomi S400 BLE advertisements into Health Dashboard ingest."""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from bleak import BleakScanner
from home_assistant_bluetooth import BluetoothServiceInfo
from xiaomi_ble.parser import XiaomiBluetoothDeviceData


SERVICE_MIBEACON = "0000fe95-0000-1000-8000-00805f9b34fb"

FIELD_MAP = {
    "mass": "weight",
    "impedance": "impedance",
    "impedance_low": "impedanceLow",
    "heart_rate": "heartRate",
    "profile_id": "profile_id",
}


@dataclass
class BridgeConfig:
    bindkey: bytes
    ingest_url: str
    ingest_token: str
    address: str | None = None
    default_user: str | None = None
    min_repeat_seconds: float = 21600.0
    settle_seconds: float = 6.0
    pending_ttl_seconds: float = 90.0
    scanner_restart_seconds: float = 900.0
    scanner_restart_delay_seconds: float = 2.0
    scanner_failure_delay_seconds: float = 15.0
    scanner_failure_exit_threshold: int = 4
    scanner_recovery_command: str | None = "bluetoothctl scan off"
    scanner_recovery_timeout_seconds: float = 10.0
    scanner_stop_timeout_seconds: float = 10.0
    post_timeout_seconds: float = 10.0
    user_map: dict[str, str] = field(default_factory=dict)


@dataclass
class PendingMeasurement:
    payload: dict[str, Any] = field(default_factory=dict)
    updated_at_monotonic: float = field(default_factory=time.monotonic)
    send_task: asyncio.Task[None] | None = None


def env_required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


def optional_command(name: str, default: str) -> str | None:
    value = os.environ.get(name, default).strip()
    return value or None


def load_config() -> BridgeConfig:
    bindkey_hex = env_required("XIAOMI_SCALE_BINDKEY").replace(" ", "")
    try:
        bindkey = bytes.fromhex(bindkey_hex)
    except ValueError as exc:
        raise SystemExit("XIAOMI_SCALE_BINDKEY must be a hex string") from exc

    if len(bindkey) != 16:
        raise SystemExit("XIAOMI_SCALE_BINDKEY must be 16 bytes / 32 hex characters")

    user_map_text = os.environ.get("XIAOMI_SCALE_USER_MAP", "").strip()
    user_map = json.loads(user_map_text) if user_map_text else {}
    if not isinstance(user_map, dict):
        raise SystemExit("XIAOMI_SCALE_USER_MAP must be a JSON object")

    return BridgeConfig(
        bindkey=bindkey,
        ingest_url=os.environ.get(
            "HEALTH_DASHBOARD_INGEST_URL",
            "http://127.0.0.1:5000/api/health-data/measurements",
        ).strip(),
        ingest_token=env_required("HEALTH_INGEST_TOKEN"),
        address=os.environ.get("XIAOMI_SCALE_ADDRESS", "").strip().upper() or None,
        default_user=os.environ.get("XIAOMI_SCALE_DEFAULT_USER", "").strip() or None,
        min_repeat_seconds=float(os.environ.get("XIAOMI_SCALE_MIN_REPEAT_SECONDS", "21600")),
        settle_seconds=float(os.environ.get("XIAOMI_SCALE_SETTLE_SECONDS", "6")),
        pending_ttl_seconds=float(os.environ.get("XIAOMI_SCALE_PENDING_TTL_SECONDS", "90")),
        scanner_restart_seconds=float(os.environ.get("XIAOMI_SCALE_SCANNER_RESTART_SECONDS", "900")),
        scanner_restart_delay_seconds=float(
            os.environ.get("XIAOMI_SCALE_SCANNER_RESTART_DELAY_SECONDS", "2")
        ),
        scanner_failure_delay_seconds=float(
            os.environ.get("XIAOMI_SCALE_SCANNER_FAILURE_DELAY_SECONDS", "15")
        ),
        scanner_failure_exit_threshold=int(
            os.environ.get("XIAOMI_SCALE_SCANNER_FAILURE_EXIT_THRESHOLD", "4")
        ),
        scanner_recovery_command=optional_command(
            "XIAOMI_SCALE_SCANNER_RECOVERY_COMMAND", "bluetoothctl scan off"
        ),
        scanner_recovery_timeout_seconds=float(
            os.environ.get("XIAOMI_SCALE_SCANNER_RECOVERY_TIMEOUT_SECONDS", "10")
        ),
        scanner_stop_timeout_seconds=float(
            os.environ.get("XIAOMI_SCALE_SCANNER_STOP_TIMEOUT_SECONDS", "10")
        ),
        post_timeout_seconds=float(os.environ.get("XIAOMI_SCALE_POST_TIMEOUT_SECONDS", "10")),
        user_map={str(key): str(value) for key, value in user_map.items()},
    )


def build_service_info(device: Any, advertisement_data: Any) -> BluetoothServiceInfo:
    return BluetoothServiceInfo(
        name=advertisement_data.local_name or device.name or "",
        address=device.address,
        rssi=advertisement_data.rssi,
        manufacturer_data=advertisement_data.manufacturer_data,
        service_data=advertisement_data.service_data,
        service_uuids=advertisement_data.service_uuids,
        source="xiaomi-s400-ble-bridge",
    )


def sensor_update_payload(sensor_update: Any, config: BridgeConfig) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": "MJTZC01YM",
    }

    for sensor_value in sensor_update.entity_values.values():
        key = str(sensor_value.device_key.key)
        target = FIELD_MAP.get(key)
        if target:
            payload[target] = sensor_value.native_value

    profile_id = payload.get("profile_id")
    if profile_id is not None:
        user = config.user_map.get(str(profile_id))
        if user:
            payload["user"] = user
    elif config.default_user:
        payload["user"] = config.default_user

    return payload


def post_payload(config: BridgeConfig, payload: dict[str, Any]) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        config.ingest_url,
        data=body,
        headers={
            "Authorization": f"Bearer {config.ingest_token}",
            "Content-Type": "application/json; charset=utf-8",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=config.post_timeout_seconds) as response:
            print(response.read().decode("utf-8"), flush=True)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        print(f"POST failed: HTTP {exc.code} {detail}", flush=True)
    except urllib.error.URLError as exc:
        print(f"POST failed: {exc.reason}", flush=True)


async def stop_scanner(scanner: BleakScanner, config: BridgeConfig) -> None:
    with contextlib.suppress(Exception):
        await asyncio.wait_for(scanner.stop(), timeout=config.scanner_stop_timeout_seconds)


def run_scanner_recovery(config: BridgeConfig) -> None:
    if config.scanner_recovery_command is None:
        return

    try:
        result = subprocess.run(
            config.scanner_recovery_command,
            capture_output=True,
            shell=True,
            text=True,
            timeout=config.scanner_recovery_timeout_seconds,
        )
    except subprocess.TimeoutExpired:
        print("BLE scanner recovery command timed out.", flush=True)
        return
    except Exception as exc:
        print(f"BLE scanner recovery command failed: {exc}", flush=True)
        return

    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        suffix = f": {detail[:200]}" if detail else ""
        print(f"BLE scanner recovery command exited {result.returncode}{suffix}", flush=True)


class XiaomiS400Bridge:
    def __init__(self, config: BridgeConfig) -> None:
        self.config = config
        self.parser = XiaomiBluetoothDeviceData(bindkey=config.bindkey)
        self.last_sent: dict[str, float] = {}
        self.pending: dict[str, PendingMeasurement] = {}

    def update_pending(self, address: str, payload: dict[str, Any]) -> PendingMeasurement:
        now = time.monotonic()
        self.expire_pending(now)
        pending = self.pending.setdefault(address, PendingMeasurement())
        pending.payload.update(payload)
        pending.payload["timestamp"] = datetime.now(timezone.utc).isoformat()
        pending.updated_at_monotonic = now

        profile_id = pending.payload.get("profile_id")
        if profile_id is not None:
            user = self.config.user_map.get(str(profile_id))
            if user:
                pending.payload["user"] = user
        elif self.config.default_user and pending.payload.get("user") is None:
            pending.payload["user"] = self.config.default_user

        return pending

    def expire_pending(self, now: float | None = None) -> None:
        current = now if now is not None else time.monotonic()
        expired = [
            address
            for address, pending in self.pending.items()
            if current - pending.updated_at_monotonic > self.config.pending_ttl_seconds
        ]
        for address in expired:
            task = self.pending[address].send_task
            if task and not task.done():
                task.cancel()
            del self.pending[address]

    def has_complete_body_payload(self, payload: dict[str, Any]) -> bool:
        return (
            payload.get("weight") is not None
            and payload.get("impedance") is not None
            and payload.get("impedanceLow") is not None
        )

    def should_send(self, payload: dict[str, Any]) -> bool:
        weight = payload.get("weight")
        impedance = payload.get("impedance")
        low_impedance = payload.get("impedanceLow")
        profile_id = payload.get("profile_id")
        user = payload.get("user")
        if weight is None or impedance is None or low_impedance is None:
            return False

        try:
            rounded_weight = round(float(weight), 1)
            rounded_impedance = round(float(impedance), 1)
            rounded_low_impedance = round(float(low_impedance), 1)
        except (TypeError, ValueError):
            return False

        person_key = str(profile_id if profile_id is not None else user or "unknown")
        key = f"{person_key}:{rounded_weight}:{rounded_impedance}:{rounded_low_impedance}"
        now = time.monotonic()
        last = self.last_sent.get(key, 0)
        if now - last < self.config.min_repeat_seconds:
            return False

        self.last_sent[key] = now
        return True

    async def send_after_settle(self, address: str) -> None:
        try:
            await asyncio.sleep(self.config.settle_seconds)
            pending = self.pending.get(address)
            if pending is None:
                return
            payload = dict(pending.payload)
            if self.should_send(payload):
                print(json.dumps(payload, ensure_ascii=False), flush=True)
                await asyncio.to_thread(post_payload, self.config, payload)
            self.pending.pop(address, None)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            print(f"Failed to send pending measurement from {address}: {exc}", flush=True)

    def on_advertisement(self, device: Any, advertisement_data: Any) -> None:
        if self.config.address and device.address.upper() != self.config.address:
            return
        if SERVICE_MIBEACON not in advertisement_data.service_data:
            return

        service_info = build_service_info(device, advertisement_data)
        try:
            if not self.parser.supported(service_info):
                return

            sensor_update = self.parser.update(service_info)
        except Exception as exc:
            print(f"Failed to parse BLE advertisement from {device.address}: {exc}", flush=True)
            return
        if not sensor_update:
            return

        payload = sensor_update_payload(sensor_update, self.config)
        pending = self.update_pending(device.address, payload)
        if self.has_complete_body_payload(pending.payload) and (
            pending.send_task is None or pending.send_task.done()
        ):
            pending.send_task = asyncio.create_task(self.send_after_settle(device.address))


async def run_scanner_once(bridge: XiaomiS400Bridge) -> None:
    scanner = BleakScanner(bridge.on_advertisement)
    started_at = time.monotonic()
    started = False

    print("Listening for Xiaomi S400 BLE advertisements...", flush=True)
    try:
        await scanner.start()
        started = True
    except Exception:
        await stop_scanner(scanner, bridge.config)
        await asyncio.to_thread(run_scanner_recovery, bridge.config)
        raise

    try:
        while True:
            restart_seconds = bridge.config.scanner_restart_seconds
            await asyncio.sleep(60.0 if restart_seconds <= 0 else min(60.0, restart_seconds))
            bridge.expire_pending()
            elapsed = time.monotonic() - started_at
            if restart_seconds > 0 and elapsed >= restart_seconds:
                print(
                    "Restarting Xiaomi S400 BLE scanner "
                    f"after {round(elapsed)} seconds.",
                    flush=True,
                )
                return
    finally:
        if started:
            await stop_scanner(scanner, bridge.config)


async def main() -> None:
    config = load_config()
    bridge = XiaomiS400Bridge(config)
    consecutive_failures = 0

    while True:
        try:
            await run_scanner_once(bridge)
            consecutive_failures = 0
        except Exception as exc:
            consecutive_failures += 1
            print(f"BLE scanner failed: {exc}", flush=True)

            if (
                config.scanner_failure_exit_threshold > 0
                and consecutive_failures >= config.scanner_failure_exit_threshold
            ):
                raise SystemExit(
                    "BLE scanner failed repeatedly; exiting for systemd restart."
                ) from exc

            await asyncio.sleep(config.scanner_failure_delay_seconds)
            continue

        await asyncio.sleep(config.scanner_restart_delay_seconds)


if __name__ == "__main__":
    asyncio.run(main())
