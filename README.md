# MemoryKeeper

Telegram-бот, который превращает свободный текст ("Пете нравится зелёный чай,
без сахара") в структурированные факты в Obsidian-совместимом vault'е и
отвечает на вопросы по накопленным фактам. LLM — [Antigravity CLI](https://antigravity.google/)
(`agy`), вызывается headless и сам решает, что делать, через MCP-инструменты,
которые предоставляет этот проект. Хранилище — обычные markdown-файлы,
синкающиеся через Google Drive (`rclone mount` на хосте) и открывающиеся в
Obsidian как есть.

Архитектура и решения подробно описаны в:
- [docs/superpowers/specs/2026-09-27-memory-keeper-design.md](docs/superpowers/specs/2026-09-27-memory-keeper-design.md) — дизайн
- [docs/superpowers/plans/2026-09-27-memory-keeper.md](docs/superpowers/plans/2026-09-27-memory-keeper.md) — план реализации

## Стек

Node.js 20 + TypeScript, [grammY](https://grammy.dev) (Telegram), `@modelcontextprotocol/sdk` (MCP-сервер), `gray-matter`/`yaml` (vault), `agy` (LLM, headless), `vitest` (тесты), Docker + `rclone` + systemd (деплой).

## Переменные окружения

| Переменная | Обязательна | Назначение |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | да | Токен бота от [@BotFather](https://t.me/BotFather) |
| `ALLOWED_TELEGRAM_ID` | да | Ваш числовой Telegram ID — единственный, кому бот отвечает |
| `VAULT_PATH` | да | Путь к папке vault'а (markdown-файлы) |
| `AGY_BIN` | нет (по умолчанию `agy`) | Путь/имя бинарника `agy` |
| `AGY_TIMEOUT` | нет (по умолчанию `2m`) | Таймаут одного headless-вызова `agy` (`Ns`/`Nm`) |

Шаблон — [.env.example](.env.example).

## Локальный запуск и тесты

```bash
npm install
npm test          # vitest, 72 теста — не требует ни Telegram, ни agy, ни сети
npm run build      # tsc -> dist/
```

Юнит-тесты полностью самодостаточны (временные vault'ы в `os.tmpdir()`,
`child_process` замокан). Живой прогон бота требует реального `agy` и
реального Telegram-токена:

```bash
# где-нибудь вне репозитория — временный vault для локальных экспериментов
mkdir -p /tmp/mk-vault

TELEGRAM_BOT_TOKEN=<токен от BotFather> \
ALLOWED_TELEGRAM_ID=<ваш Telegram ID> \
VAULT_PATH=/tmp/mk-vault \
AGY_BIN=agy \
node dist/index.js
```

Проверить, что MCP-сервер сам по себе (без бота) регистрирует все
инструменты и корректно читает/пишет файлы, можно через официальный
[MCP Inspector](https://github.com/modelcontextprotocol/inspector), не
поднимая Telegram вообще:

```bash
VAULT_PATH=/tmp/mk-vault npx @modelcontextprotocol/inspector node dist/mcp/server.js
```

## Docker

```bash
cp .env.example .env   # заполнить TELEGRAM_BOT_TOKEN и ALLOWED_TELEGRAM_ID
mkdir -p /mnt/memory-vault   # для локального теста сойдёт и обычная папка
docker compose -f docker/docker-compose.yml --env-file .env build
docker compose -f docker/docker-compose.yml --env-file .env up
```

Контейнер получает `/mnt/memory-vault` как обычный bind-mount volume — сам
Docker ничего не монтирует через `rclone`/FUSE, это осознанно вынесено на
хост (см. ниже). OAuth-токен `agy` (после `agy auth login`) сохраняется в
именованном volume `agy-auth`, примонтированном на весь `~/.gemini` внутри
контейнера — переживает пересборку и пересоздание контейнера.

## Деплой на VPS

Ключевая идея: `rclone mount` (Google Drive → локальная папка) живёт на
хосте вне Docker, потому что проброс FUSE в контейнер требует
`--privileged`/`--device /dev/fuse` и заметно всё усложняет. Контейнер с
ботом получает уже смонтированную папку как обычный volume.

1. **rclone**: `rclone config` на VPS, добавить remote `gdrive` (Google
   Drive, пройти OAuth в браузере — с headless-сервера удобнее всего через
   `rclone authorize` с временным SSH-туннелем).
2. **Mount-юнит**:
   ```bash
   sudo cp deploy/memory-vault-mount.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now memory-vault-mount.service
   mountpoint /mnt/memory-vault   # должно сказать "is a mountpoint"
   ```
3. **Логин `agy`** (VPS headless, поэтому нужен туннель для OAuth-колбэка):
   ```bash
   ssh -L 8085:localhost:8085 <user>@<vps-host>
   # внутри SSH-сессии на VPS:
   agy auth login
   ```
   Открыть выведенную ссылку в локальном браузере — колбэк на
   `localhost:8085` дойдёт до VPS через проброшенный порт. Учтите: сам факт,
   что headless-режим `agy` работает с подпиской Google AI Pro/Ultra через
   обычный логин, а не только с платным `GEMINI_API_KEY` — не подтверждён
   документацией на момент написания. Проверьте прямо здесь:
   ```bash
   agy --output-format json -p "скажи привет одним словом"
   ```
   Если просит `GEMINI_API_KEY` — либо используйте платный ключ (`AGY_BIN`/
   конфиг `agy` можно скорректировать под него), либо решайте это до
   следующего шага.
4. **Деплой бота**:
   ```bash
   sudo mkdir -p /opt/memory-keeper
   # скопировать репозиторий в /opt/memory-keeper (git clone или rsync)
   cd /opt/memory-keeper
   cp .env.example .env   # заполнить TELEGRAM_BOT_TOKEN и ALLOWED_TELEGRAM_ID
   sudo cp deploy/memory-keeper.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now memory-keeper.service
   docker compose -f docker/docker-compose.yml logs -f
   ```
5. **Проверка**: напишите боту в Telegram со своего аккаунта "Пете нравится
   зелёный чай" → должен подтвердить запись, и файл появится в
   `People/Петя.md` (виден в Google Drive/Obsidian). Спросите "какой чай у
   Пети?" → должен ответить по факту.

### Известное ограничение деплоя

`memory-keeper.service` отказывается стартовать, если `/mnt/memory-vault` ещё
не примонтирован (`ExecStartPre=mountpoint -q ...`) — это осознанная защита
от того, чтобы бот тихо начал писать vault на локальный диск VPS вместо
Google Drive. Но `memory-vault-mount.service` (`Type=simple`) отчитывается
systemd как "запущен" уже в момент форка процесса `rclone`, а не когда FUSE-
mount реально готов, и `memory-keeper.service` не перезапускается
автоматически при неудаче. **После перезагрузки VPS бот может не подняться**,
если `rclone` не успел смонтировать диск к моменту проверки — тогда:

```bash
sudo systemctl restart memory-keeper.service
```

Надёжный автоматический фикс (цикл ожидания в `ExecStartPre`, либо
`Type=notify` на rclone-юните, либо `Restart=on-failure` на
`memory-keeper.service`) — на данный момент не реализован, оставлено как
известный follow-up.

## Модель данных vault'а

Один markdown-файл на сущность, тип задаётся `_schema.yaml` в корне vault'а
(по умолчанию `person` → `People/`, `event` → `Events/`). Частые факты
продвигаются в YAML-frontmatter, разовые — остаются bullet-списком под
`## Факты`. Изменения схемы (`propose_schema_change` → `/confirm_schema
<id>` в Telegram) применяются только по явному подтверждению — LLM не может
менять схему сама. Подробности — в спеке (ссылка выше).
