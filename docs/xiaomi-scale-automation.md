# Xiaomi Scale Automation

Цель: после измерения весов новая запись автоматически попадает в `xiaomi-body-scale-data.json`, сервер обновляет CSV и открытый дашборд получает WebSocket-событие.

## Архитектура

```text
Xiaomi Body Composition Scale S400
  -> BLE bridge service on a local Linux host
  -> POST /api/health-data/measurements
  -> xiaomi-body-scale-data.json + CSV
  -> chokidar + WebSocket
  -> dashboard
```

Серверная часть готова. `POST /api/health-data/measurements` принимает измерение, нормализует поля в текущую health-схему, атомарно обновляет JSON, регенерирует wide/long CSV и отправляет UI событие `health-data-updated`.

Endpoint включается только при заданном токене:

```bash
HEALTH_INGEST_TOKEN="long-random-token" HOST=0.0.0.0 npm run dev
```

Для deployed сервиса `HEALTH_INGEST_TOKEN` хранится в systemd environment. Значение токена нельзя выводить в чат, логи, docs или коммиты.

## Smoke Test

```bash
curl -X POST "http://127.0.0.1:5000/api/health-data/measurements" \
  -H "Authorization: Bearer $HEALTH_INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "user": "Demo User",
    "timestamp": "2026-06-06T09:00:00+03:00",
    "weight": 62.1,
    "impedance": 455.2,
    "impedanceLow": 410.4,
    "heartRate": 88,
    "bmi": 20.3,
    "bodyFatPercent": 12.2,
    "waterPercent": 67.1,
    "muscleMass": 51.7,
    "boneMass": 3.0,
    "visceralFat": 2,
    "bmr": 1550,
    "metabolicAge": 18,
    "physiqueRating": 7,
    "model": "MJTZC01YM"
  }'
```

Сервер считает повторные измерения одного пользователя с тем же весом в пределах 15 минут дубликатами. BLE bridge дополнительно подавляет тот же `(profile_id, weight, impedance, impedanceLow)` fingerprint на `21600` секунд.

## Рекомендуемый Сбор Данных

### Текущий deployed-вариант: Standalone BLE Bridge

На локальном Linux-хосте работает user systemd service `xiaomi-scale-bridge.service`. Bridge слушает BLE-рекламы S400, расшифровывает MiBeacon V5 через `XIAOMI_SCALE_BINDKEY`, накапливает BLE-фрагменты по адресу весов и ждет `weight`, `impedance` и `impedanceLow`, затем выдерживает короткое окно для `profile_id` и `heartRate` и отправляет один payload в dashboard. BLE scanner внутри процесса перезапускается по таймеру, чтобы BlueZ/Bleak не оставались в тихом зависшем состоянии overnight при живом systemd-процессе.

Основные файлы:

```text
$HOME/apps/health-dashboard/scripts/xiaomi-s400-ble-bridge.py
$HOME/apps/health-dashboard/requirements-scale-bridge.txt
$HOME/apps/health-dashboard/deploy/install-scale-bridge.sh
$HOME/.config/health-dashboard/xiaomi-scale-bridge.env
```

`xiaomi-scale-bridge.env` содержит `XIAOMI_SCALE_BINDKEY` и `HEALTH_INGEST_TOKEN`; не печатайте значения секретов.

Проверка:

```bash
systemctl --user status health-dashboard.service
systemctl --user status xiaomi-scale-bridge.service
journalctl --user -u xiaomi-scale-bridge.service -f
curl -sS http://127.0.0.1:5000/api/status
```

Схема payload:

```json
{
  "profile_id": 1,
  "timestamp": "2026-06-06T09:00:00+03:00",
  "weight": 62.1,
  "impedance": 455.2,
  "impedanceLow": 410.4,
  "heartRate": 88,
  "model": "MJTZC01YM"
}
```

Если `profile_id` совпадает с `users[].type_code` в JSON, сервер сам выберет пользователя. Например: `1 -> Demo User`, `2 -> Partner`.

### Локальный запуск bridge для отладки

Используйте pinned requirements. Для текущего стека важен `bleak<1`.

```bash
python3 -m venv .venv-scale-bridge
. .venv-scale-bridge/bin/activate
pip install -r requirements-scale-bridge.txt

export XIAOMI_SCALE_BINDKEY="32-hex-chars"
export HEALTH_INGEST_TOKEN="same-token-as-dashboard"
export HEALTH_DASHBOARD_INGEST_URL="http://127.0.0.1:5000/api/health-data/measurements"
export XIAOMI_SCALE_ADDRESS="8C:D0:B2:F6:BE:EF"
export XIAOMI_SCALE_DEFAULT_USER="Demo User"
export XIAOMI_SCALE_SETTLE_SECONDS=6
export XIAOMI_SCALE_PENDING_TTL_SECONDS=90
export XIAOMI_SCALE_SCANNER_RESTART_SECONDS=900
export XIAOMI_SCALE_SCANNER_RESTART_DELAY_SECONDS=2
export XIAOMI_SCALE_SCANNER_FAILURE_DELAY_SECONDS=15
export XIAOMI_SCALE_SCANNER_FAILURE_EXIT_THRESHOLD=4
export XIAOMI_SCALE_SCANNER_RECOVERY_COMMAND="bluetoothctl scan off"
export XIAOMI_SCALE_SCANNER_RECOVERY_TIMEOUT_SECONDS=10
export XIAOMI_SCALE_SCANNER_STOP_TIMEOUT_SECONDS=10
export XIAOMI_SCALE_POST_TIMEOUT_SECONDS=10

python scripts/xiaomi-s400-ble-bridge.py
```

`XIAOMI_SCALE_ADDRESS` опционален, но лучше задать его, если рядом есть другие Xiaomi BLE устройства. Если понадобится явная карта пользователей, добавьте:

```bash
export XIAOMI_SCALE_USER_MAP='{"1":"Demo User","2":"Partner"}'
```

Если BLE payload приходит без `profile_id`, bridge использует `XIAOMI_SCALE_DEFAULT_USER`, когда переменная задана. Сервер также сам выбирает пользователя, когда в `xiaomi-body-scale-data.json` есть ровно один пользователь. Для нескольких пользователей без стабильного `profile_id` задайте `XIAOMI_SCALE_DEFAULT_USER` на bridge или `HEALTH_INGEST_DEFAULT_USER` на сервере.

`XIAOMI_SCALE_SCANNER_RESTART_SECONDS` задает мягкий restart BLE scanner внутри процесса. Значение `900` означает restart каждые 15 минут; `0` отключает таймер. Bridge логирует `Restarting Xiaomi S400 BLE scanner ...` перед каждым таким циклом. Если BlueZ возвращает `org.bluez.Error.InProgress`, bridge пробует остановить stale discovery через `XIAOMI_SCALE_SCANNER_RECOVERY_COMMAND`, делает backoff и после `XIAOMI_SCALE_SCANNER_FAILURE_EXIT_THRESHOLD` подряд ошибок завершает процесс для systemd restart.

Если kernel log показывает `Bluetooth: hci0: command 0x200c tx timeout` или `Bluetooth: hci0: Unable to disable scanning`, завис USB Bluetooth controller. Сбросить его можно так:

```bash
sudo /home/bulat/apps/health-dashboard/deploy/reset-scale-bluetooth.sh
```

Для автоматического сброса застрявшего `hci0` установите root watchdog timer:

```bash
sudo /home/bulat/apps/health-dashboard/deploy/install-scale-bluetooth-watchdog.sh
```

Watchdog проверяет bridge и kernel log раз в 24 часа. При повторении `InProgress` или `hci0` timeout он запускает тот же reset-скрипт с cooldown.

### Альтернатива: Home Assistant Xiaomi BLE

Home Assistant можно использовать как BLE scanner и automation runner:

1. Поставить Home Assistant на устройство с Bluetooth рядом с весами.
2. Добавить интеграцию Xiaomi BLE.
3. Добавить bindkey для весов через Xiaomi Cloud import или вручную.
4. Включить sensor entities: mass, impedance, impedance low, heart rate, profile id.
5. Создать automation, которая при изменении стабилизированного веса отправляет POST в dashboard.

### Альтернатива: Xiaomi Home + BLE Gateway + Cloud Sync

S400 умеет работать через Xiaomi Home и BLE gateway. При наличии gateway запись попадает в Xiaomi cloud, после чего ее можно забирать через SmartScaleConnect или аналогичный sync job.

Этот вариант сохраняет значения, рассчитанные Xiaomi Home, и добавляет облачные credentials, polling и зависимость от приватного API Xiaomi. Endpoint подходит и для такого sync job: он должен преобразовать запись в JSON payload и отправить его в dashboard.

## Payload Fields

Endpoint понимает эти имена:

| Dashboard metric | Accepted source fields |
| --- | --- |
| `weight_kg` | `weight`, `weight_kg`, `mass`, `mass_kg` |
| `body_fat_percent` | `bodyFatPercent`, `body_fat_percent` |
| `body_water_percent` | `waterPercent`, `body_water_percent` |
| `muscle_mass_kg` | `muscleMass`, `muscle_mass` |
| `bone_mineral_content_kg` | `boneMass`, `bone_mass` |
| `visceral_fat_rating` | `visceralFat`, `visceral_fat` |
| `basal_metabolic_rate_kcal` | `bmr` |
| `body_age_years` | `metabolicAge` |
| `bioimpedance_resistance_raw` | `impedance` |
| `bioimpedance_resistance_2_raw` | `impedanceLow`, `impedance_low` |
| `heart_rate_bpm` | `heartRate`, `heart_rate_bpm` |

Если входной payload содержит `profile_id`, `duid` или `user_type_code`, сервер использует это значение для выбора пользователя из `users[].type_code`.

Если BLE payload содержит только сырые поля S400, сервер дополняет недостающие body composition metrics из предыдущих полных отчетов пользователя методом `weighted nearest Xiaomi Home full reports`. В source metadata появятся `derived_metrics_method` и `derived_metric_keys`. Благодаря этому quick metrics в dashboard должны обновляться одним timestamp: weight, body fat, muscle, water, score и heart rate.
