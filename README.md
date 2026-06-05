# Health Dashboard

Локальный дашборд здоровья для данных Xiaomi Body Scale из Obsidian Vault.

## Запуск

```bash
npm install
npm run dev
```

Откройте `http://127.0.0.1:5000`.

Для доступа с телефона или Windows-ноутбука в одной сети:

```bash
HOST=0.0.0.0 npm run dev
```

Затем откройте `http://<ip-адрес-mac>:5000` на другом устройстве.

## Источник данных

По умолчанию сервер читает:

```text
/Users/bulatmotygullin/Documents/Obsidian_Vault/007 - Shelf/Health/Xiaomi Body Scale
```

Путь можно переопределить:

```bash
HEALTH_DATA_DIR="/path/to/Xiaomi Body Scale" npm run dev
```

Сервер следит за обновлениями JSON/CSV/Markdown в этой папке и сообщает интерфейсу о новых данных через WebSocket.
