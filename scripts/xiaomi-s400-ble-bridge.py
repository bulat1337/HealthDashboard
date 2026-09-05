#!/usr/bin/env python3
"""Bridge Xiaomi S400 BLE advertisements into Health Dashboard ingest."""

from __future__ import annotations

import asyncio
import contextlib
import json
import math
import struct
from pathlib import Path
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
from xiaomi_ble.parser import XiaomiBluetoothDeviceData, xiaomi_dataobject_dict


SERVICE_MIBEACON = "0000fe95-0000-1000-8000-00805f9b34fb"

# Keep the upstream authenticated MiBeacon decoder, but consume fresh S400 objects.
# SensorUpdate.entity_values is cumulative and can combine two different weigh-ins.
_original_s400_handler = xiaomi_dataobject_dict[0x6E16]


def decode_s400_object(raw: bytes) -> dict[str, Any]:
    if len(raw) != 9:
        return {}
    profile, data, timestamp = struct.unpack("<BII", raw)
    if not data:
        return {}
    mass, heart, impedance = data & 0x7FF, (data >> 11) & 0x7F, data >> 18
    fragment: dict[str, Any] = {"profile_id": profile, "device_timestamp_raw": timestamp}
    if mass:
        fragment["weight"] = mass / 10
    if impedance:
        fragment["impedance" if mass else "impedanceLow"] = impedance / 10
    if 0 < heart < 127:
        fragment["heartRate"] = heart + 50
    return fragment


def capture_s400_object(raw: bytes, device: Any, device_type: str) -> dict[str, Any]:
    fragment = decode_s400_object(raw)
    if fragment and hasattr(device, "scale_fragments"):
        device.scale_fragments.append(fragment)
    return _original_s400_handler(raw, device, device_type) if len(raw) == 9 else {}


xiaomi_dataobject_dict[0x6E16] = capture_s400_object


@dataclass
class BridgeConfig:
    bindkey: bytes
    ingest_url: str
    ingest_token: str
    address: str | None = None
    default_user: str | None = None
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
    state_file: str = ""
    retry_seconds: float = 15.0
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
        state_file=os.environ.get("XIAOMI_SCALE_STATE_FILE", str(Path.home() / ".local/state/health-dashboard/scale-bridge.json")),
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


def post_payload(config: BridgeConfig, payload: dict[str, Any]) -> bool:
    request = urllib.request.Request(
        config.ingest_url,
        data=json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8"),
        headers={"Authorization": f"Bearer {config.ingest_token}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=config.post_timeout_seconds) as response:
            result = json.loads(response.read())
            if not isinstance(result, dict) or not isinstance(result.get("duplicate"), bool):
                raise ValueError("Missing ingest acknowledgement")
            print(f"Measurement acknowledged (duplicate={result['duplicate']}).", flush=True)
            return True
    except urllib.error.HTTPError as exc:
        print(f"POST failed: HTTP {exc.code}; measurement retained for retry.", flush=True)
    except (OSError, ValueError) as exc:
        print(f"POST failed: {type(exc).__name__}; measurement retained for retry.", flush=True)
    return False


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
        self.parsers: dict[str, Any] = {}
        self.last_sent: dict[str, str] = {}
        self.outbox: dict[str, dict[str, Any]] = {}
        self.pending: dict[str, PendingMeasurement] = {}
        self.scanning = False
        self.last_advertisement_at: float | None = None
        self.last_scale_at: float | None = None
        self.last_success_at: float | None = None
        self.last_error: str | None = None
        if config.state_file and Path(config.state_file).exists():
            state = json.loads(Path(config.state_file).read_text())
            self.last_sent = state.get("last_sent", {})
            self.outbox = state.get("outbox", {})
            self.last_success_at = state.get("last_success_at")

    def persist(self) -> None:
        if not self.config.state_file:
            return
        target = Path(self.config.state_file)
        target.parent.mkdir(parents=True, exist_ok=True)
        temp = target.with_suffix(".tmp")
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as stream:
            json.dump({"last_sent": self.last_sent, "outbox": self.outbox,
                       "heartbeat_at": time.time(), "scanning": self.scanning,
                       "last_advertisement_at": self.last_advertisement_at,
                       "last_scale_at": self.last_scale_at,
                       "last_success_at": self.last_success_at,
                       "last_error": self.last_error}, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, target)

    def person_key(self, payload: dict[str, Any]) -> str:
        return f"{payload.get('device_id', '')}:{payload.get('profile_id', payload.get('user', 'unknown'))}"

    def fingerprint(self, payload: dict[str, Any]) -> str | None:
        values = [payload.get(k) for k in ("weight", "impedance", "impedanceLow")]
        try:
            if not all(math.isfinite(float(v)) and float(v) > 0 for v in values):
                return None
        except (TypeError, ValueError):
            return None
        # Device timestamp separates genuinely new identical results when available.
        return json.dumps([payload.get("device_timestamp_raw", 0), *[round(float(v), 1) for v in values]])

    async def deliver_outbox(self) -> None:
        while True:
            for key, payload in list(self.outbox.items()):
                if await asyncio.to_thread(post_payload, self.config, payload):
                    self.last_sent[self.person_key(payload)] = self.fingerprint(payload) or ""
                    self.outbox.pop(key, None)
                    self.last_success_at = time.time()
                    self.last_error = None
                    self.persist()
                else:
                    self.last_error = "ingest_delivery_failed"
                    continue
            self.persist()
            await asyncio.sleep(self.config.retry_seconds)

    def update_pending(self, address: str, payload: dict[str, Any]) -> PendingMeasurement:
        now = time.monotonic()
        self.expire_pending(now)
        pending = self.pending.setdefault(address, PendingMeasurement())
        pending.payload.update(payload)
        pending.payload.setdefault("timestamp", datetime.now(timezone.utc).isoformat())
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
        fingerprint = self.fingerprint(payload)
        return fingerprint is not None and self.last_sent.get(self.person_key(payload)) != fingerprint

    async def send_after_settle(self, address: str) -> None:
        try:
            await asyncio.sleep(self.config.settle_seconds)
            pending = self.pending.get(address)
            if pending is None:
                return
            payload = dict(pending.payload)
            if self.should_send(payload):
                key = self.person_key(payload) + ":" + str(self.fingerprint(payload))
                # A retry retains the timestamp of the first observation.
                if key not in self.outbox:
                    self.outbox[key] = payload
                    self.persist()
            self.pending.pop(address, None)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            print(f"Failed to send pending measurement from {address}: {exc}", flush=True)

    def on_advertisement(self, device: Any, advertisement_data: Any) -> None:
        self.last_advertisement_at = time.time()
        address = device.address.upper()
        if self.config.address and address != self.config.address:
            return
        if SERVICE_MIBEACON not in advertisement_data.service_data:
            return
        parser = self.parsers.get(address)
        if parser is None:
            parser = XiaomiBluetoothDeviceData(bindkey=self.config.bindkey)
            self.parsers[address] = parser
        parser.scale_fragments = []
        try:
            info = build_service_info(device, advertisement_data)
            if not parser.supported(info):
                return
            parser.update(info)
        except Exception as exc:
            print(f"Failed to parse BLE advertisement: {type(exc).__name__}", flush=True)
            return
        for fragment in parser.scale_fragments:
            self.last_scale_at = time.time()
            payload = {"model": "MJTZC01YM", "device_id": address, "source_app": "Xiaomi S400 BLE bridge", **fragment}
            # Pair only fragments for the same device, profile and device timestamp.
            key = f"{address}:{fragment['profile_id']}:{fragment['device_timestamp_raw']}"
            if fragment["device_timestamp_raw"]:
                payload["source_measurement_id"] = key
            pending = self.update_pending(key, payload)
            if self.has_complete_body_payload(pending.payload) and (
                pending.send_task is None or pending.send_task.done()
            ):
                pending.send_task = asyncio.create_task(self.send_after_settle(key))


async def run_scanner_once(bridge: XiaomiS400Bridge) -> None:
    scanner = BleakScanner(bridge.on_advertisement)
    started_at = time.monotonic()
    started = False

    try:
        await asyncio.wait_for(scanner.start(), timeout=30)
        started = True
        bridge.scanning = True
        bridge.last_error = None
        bridge.persist()
        print("Listening for Xiaomi S400 BLE advertisements...", flush=True)
    except Exception:
        await stop_scanner(scanner, bridge.config)
        await asyncio.to_thread(run_scanner_recovery, bridge.config)
        raise

    try:
        while True:
            restart_seconds = bridge.config.scanner_restart_seconds
            await asyncio.sleep(60.0 if restart_seconds <= 0 else min(60.0, restart_seconds))
            bridge.expire_pending()
            last_radio = bridge.last_advertisement_at
            if last_radio is not None and time.time() - last_radio > 180:
                raise RuntimeError("BLE scanner failed: no advertisements for 180 seconds")
            elapsed = time.monotonic() - started_at
            if restart_seconds > 0 and elapsed >= restart_seconds:
                print(
                    "Restarting Xiaomi S400 BLE scanner "
                    f"after {round(elapsed)} seconds.",
                    flush=True,
                )
                return
    finally:
        bridge.scanning = False
        bridge.persist()
        if started:
            await stop_scanner(scanner, bridge.config)


async def main() -> None:
    config = load_config()
    bridge = XiaomiS400Bridge(config)
    consecutive_failures = 0
    delivery_task = asyncio.create_task(bridge.deliver_outbox())

    while True:
        try:
            if delivery_task.done():
                delivery_task.result()
            await run_scanner_once(bridge)
            consecutive_failures = 0
        except Exception as exc:
            consecutive_failures += 1
            bridge.scanning = False
            bridge.last_error = "scanner_failed"
            bridge.persist()
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
