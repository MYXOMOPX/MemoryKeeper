# LLM backend selection (agy vs Gemini API) — дизайн

Дата: 2026-09-29

## Назначение

Сегодня бот вызывает LLM единственным способом — headless `agy` CLI
(`runHeadless`), напрямую из `src/bot/index.ts`. Пользователь хочет
сравнить это с прямым вызовом Gemini API (обычный платный тариф по
токенам, осознанно — не бесплатно, в отличие от `agy` через подписку).
"Воткнуть Claude в таком же режиме" уже работает без изменений в коде:
`agy` поддерживает `claude-sonnet-4-6`/`claude-opus-4-6-thinking` через
`--model`, что уже прокинуто как `AGY_MODEL`.

Выбор бэкенда — только через переменную окружения при деплое (без
переключения на лету, без выбора команды в Telegram — осознанное
упрощение для личного бота).

## Архитектура

Вводим общий тип:

```ts
// src/llm/backend.ts
export type LlmBackend = (prompt: string) => Promise<{ response: string; raw: unknown }>;

export function createLlmBackend(config: Config): LlmBackend {
  switch (config.llmBackend) {
    case 'agy':
      return createAgyBackend(config);
    case 'gemini-api':
      return createGeminiApiBackend(config);
  }
}
```

`src/bot/index.ts` создаёт `backend` один раз при старте бота и в
обработчике сообщений вызывает `backend(prompt)` вместо прямого
`runHeadless(...)`. Это единственное изменение в существующем коде бота —
вся остальная логика (диспетчеризация промпта, `CLARIFY:`-конвенция,
интерпретация ответа) не зависит от того, какой бэкенд отвечает.

```
Telegram → bot/index.ts → backend(prompt) → { agy: agyBackend | gemini-api: geminiApiBackend }
                                                        │                         │
                                                  runHeadless (как есть)   свой tool-calling цикл
                                                        │                         │
                                                MCP-сервер (agy сам решает) handlers.ts напрямую
```

## `agyBackend` — тонкая обёртка

`src/llm/agyBackend.ts`: `createAgyBackend(config): LlmBackend` просто
вызывает существующий `runHeadless(prompt, {agyBin, timeout, cwd, model})`
из `src/agy/runHeadless.ts` — **без изменений в самом `runHeadless`**.
Ничего в уже протестированной логике (kill-таймер, парсинг JSON) не
трогаем.

## `geminiApiBackend` — новый агентный цикл

`src/llm/geminiApiBackend.ts`, SDK — `@google/genai`. У Gemini API нет
своего автономного агентного цикла (в отличие от `agy`), поэтому ведём
его сами:

1. История начинается с одного `{role: 'user', text: prompt}`.
2. Вызываем `generateContent` с объявленными инструментами
   (`functionDeclarations`, см. ниже).
3. Если в ответе есть `functionCall(s)` — для каждого вызываем
   соответствующую функцию из `src/mcp/handlers.ts` **напрямую** (MCP-
   транспорт тут не нужен — это тот же процесс), добавляем в историю
   `functionResponse` с результатом (или с текстом ошибки, если хендлер
   бросил исключение — не роняем цикл, даём модели шанс отреагировать) и
   повторяем шаг 2.
4. Если функций в ответе нет — это финальный текст, возвращаем его.
5. Жёсткий лимит на число итераций (константа, не настраивается —
   внутренняя защита от зацикливания, не бизнес-логика).
6. Таймаут всего цикла — через `AbortController`, длительность из
   `GEMINI_API_TIMEOUT` (тот же формат `Ns`/`Nm`, тот же
   `parseTimeoutToMs`).

### Схемы инструментов для Gemini

7 инструментов (без `apply_schema_change` — он и так недоступен LLM,
см. текущий `server.ts`) описываются как обычный JSON Schema
(`parametersJsonSchema` — формат, который прямо принимает
`@google/genai`), **отдельно** от zod-схем в `server.ts`. Да, это
дублирование описания параметров в двух местах (MCP-путь и Gemini-API-
путь) — осознанно: подключать библиотеку конвертации ради 7
инструментов не оправдано, а расхождение поймает интеграционный тест
(вызов каждого инструмента через новый бэкенд с реальными хендлерами
из `test/helpers/tmpVault.ts`, как в `test/mcp/handlers.test.ts`).

## Конфиг

Новые поля в `Config` (`src/config.ts`):

| Переменная | Обязательна | По умолчанию | Назначение |
|---|---|---|---|
| `LLM_BACKEND` | нет | `agy` | `agy` \| `gemini-api` |
| `GEMINI_API_KEY` | только если `LLM_BACKEND=gemini-api` | — | Ключ Gemini API |
| `GEMINI_API_MODEL` | нет | `gemini-2.5-flash-lite` | Модель для прямого API |
| `GEMINI_API_TIMEOUT` | нет | `2m` | Таймаут всего цикла (формат как `AGY_TIMEOUT`) |

`AGY_BIN`/`AGY_TIMEOUT`/`AGY_CWD`/`AGY_MODEL` остаются как есть — они
специфичны только для `agy`-бэкенда, не переименовываются и не
обобщаются под gemini-api.

Валидация: `GEMINI_API_KEY` требуется, только если `LLM_BACKEND=gemini-
api` — при `agy` (по умолчанию) можно вообще не задавать.

## Переименование (косметика)

`interpretAgyResponse` (`src/bot/respond.ts`) → `interpretLlmResponse` —
функция больше не специфична для `agy`, оставлять имя с "Agy" в
backend-агностичном коде вводит в заблуждение. Чисто rename, поведение
не меняется.

## Файлы

```
src/llm/
  backend.ts          — LlmBackend, createLlmBackend()
  agyBackend.ts        — createAgyBackend() (обёртка над runHeadless)
  geminiApiBackend.ts  — createGeminiApiBackend() (свой tool-calling цикл)
  toolDeclarations.ts  — JSON Schema для 7 инструментов (для Gemini API)
```

`src/agy/runHeadless.ts` не меняется. `src/bot/index.ts` меняется
минимально: вместо `runHeadless(...)` — `backend(prompt)`.

## Обработка ошибок

| Ситуация | Поведение |
|---|---|
| `GEMINI_API_KEY` не задан при `LLM_BACKEND=gemini-api` | `loadConfig` бросает ошибку при старте (fail fast, как остальные обязательные переменные) |
| Хендлер инструмента бросил исключение во время цикла | Текст ошибки уходит модели как `functionResponse`, цикл продолжается — не падает |
| Превышен лимит итераций | Цикл прерывается с понятной ошибкой (аналогично таймауту в `agyBackend`) — ловится тем же `try/catch` в `bot/index.ts`, что и сейчас |
| Таймаут `AbortController` | Аналогично — ошибка ловится существующим `try/catch`, пользователь получает `Ошибка: ...` |

## Тестирование

- `test/llm/geminiApiBackend.test.ts` — мокаем `@google/genai` клиент
  (аналогично моку `node:child_process` для `runHeadless`): (1) текстовый
  ответ без вызова инструментов, (2) один цикл с вызовом инструмента и
  продолжением, (3) ошибка хендлера не роняет цикл, (4) срабатывание
  лимита итераций, (5) срабатывание таймаута.
- `test/llm/agyBackend.test.ts` — тривиальный тест, что обёртка
  корректно прокидывает опции в `runHeadless` (сам `runHeadless` уже
  покрыт).
- `test/bot/respond.test.ts` — переименовать вместе с функцией, поведение
  тестов не меняется.
- Интеграционный тест для `toolDeclarations.ts` против реальных хендлеров
  (temp vault), чтобы расхождение JSON Schema с zod-схемами в `server.ts`
  ловилось автоматически, а не только вручную.

## Вне рамок

- Переключение бэкенда на лету (команда в Telegram) — только env var.
- Библиотека конвертации zod → JSON Schema — 7 инструментов, дублирование
  вручную дешевле лишней зависимости.
- Модели Claude через прямой API (Anthropic) — не запрашивалось; Claude
  уже доступен через `agy` (`AGY_MODEL=claude-sonnet-4-6`).
- Настраиваемый лимит итераций tool-calling цикла — внутренняя константа.
