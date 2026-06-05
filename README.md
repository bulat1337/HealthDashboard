# Life Dashboard

Локальный сайт для личных данных и привычек. Текущие разделы: здоровье из Xiaomi Body Scale, деньги из `Money.md` и счетчик отношений.

Планируемые будущие разделы: спорт и другие области жизни.

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

## Источники данных

По умолчанию сервер читает данные здоровья:

```text
/Users/bulatmotygullin/Documents/Obsidian_Vault/007 - Shelf/Health/Xiaomi Body Scale
```

Файл денег:

```text
/Users/bulatmotygullin/Documents/Obsidian_Vault/007 - Shelf/Personal/Management/Money.md
```

Пути можно переопределить:

```bash
HEALTH_DATA_DIR="/path/to/Xiaomi Body Scale" npm run dev
MONEY_DATA_FILE="/path/to/Money.md" npm run dev
```

Сервер следит за обновлениями JSON/CSV/Markdown здоровья и файла денег, затем сообщает интерфейсу о новых данных через WebSocket.

## Worktrees

Для отдельных задач используйте worktree внутри корня проекта:

```bash
git worktree add -b codex/<task-slug> .worktrees/<task-slug> main
```

Папка `.worktrees/` добавлена в `.gitignore`.
