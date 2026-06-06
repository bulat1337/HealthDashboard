#!/usr/bin/env python3
"""Bridge Xiaomi S400 BLE advertisements into Health Dashboard ingest."""

from __future__ import annotations

import asyncio
import json
import os
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
    min_repeat_seconds: float = 21600.0
    settle_seconds: float = 6.0
    pending_ttl_seconds: float = 90.0
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
        min_repeat_seconds=float(os.environ.get("XIAOMI_SCALE_MIN_REPEAT_SECONDS", "21600")),
        settle_seconds=float(os.environ.get("XIAOMI_SCALE_SETTLE_SECONDS", "6")),
        pending_ttl_seconds=float(os.environ.get("XIAOMI_SCALE_PENDING_TTL_SECONDS", "90")),
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
        with urllib.request.urlopen(request, timeout=10) as response:
            print(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        print(f"POST failed: HTTP {exc.code} {detail}", flush=True)
    except urllib.error.URLError as exc:
        print(f"POST failed: {exc.reason}", flush=True)


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
            and (payload.get("profile_id") is not None or payload.get("user") is not None)
        )

    def should_send(self, payload: dict[str, Any]) -> bool:
        weight = payload.get("weight")
        impedance = payload.get("impedance")
        low_impedance = payload.get("impedanceLow")
        profile_id = payload.get("profile_id")
        user = payload.get("user")
        if (
            weight is None
            or impedance is None
            or low_impedance is None
            or (profile_id is None and user is None)
        ):
            return False

        try:
            rounded_weight = round(float(weight), 1)
            rounded_impedance = round(float(impedance), 1)
            rounded_low_impedance = round(float(low_impedance), 1)
        except (TypeError, ValueError):
            return False

        person_key = str(profile_id if profile_id is not None else user)
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
                post_payload(self.config, payload)
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


async def main() -> None:
    config = load_config()
    bridge = XiaomiS400Bridge(config)
    scanner = BleakScanner(bridge.on_advertisement)

    print("Listening for Xiaomi S400 BLE advertisements...", flush=True)
    await scanner.start()
    try:
        while True:
            await asyncio.sleep(3600)
    finally:
        await scanner.stop()


if __name__ == "__main__":
    asyncio.run(main())
