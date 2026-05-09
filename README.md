# Star Atlas App

Отдельный monorepo-проект для аналитики Star Atlas:

- web (React + Vite)
- api (Fastify + TypeScript)
- bot (заготовка для Telegram)
- shared (общие типы)

## Структура

- apps/web - клиентский интерфейс MVP
- apps/api - API для дашборда
- apps/bot - стартовый runtime для будущей интеграции Telegram
- packages/shared - общие контракты данных

## Быстрый старт

```bash
cd /Users/biz/star-atlas-app
npm install
npm run dev
```

Если запускается только web, API нужно поднять отдельно, иначе запросы `/api/*` будут возвращать `ECONNREFUSED`:

```bash
npm run dev:web
npm run dev:api
```

По умолчанию:

- Web: http://127.0.0.1:5173
- API: http://127.0.0.1:4100

Примечание: если порт `5173` занят, Vite автоматически выберет следующий свободный порт (например, `5174`).

## Полезные команды

```bash
npm run dev:web
npm run dev:api
npm run dev:bot
npm run build
npm run smoke:api
```

## Инфраструктура (отдельное приложение)

Для отдельного запуска Star Atlas как самостоятельного приложения добавлен инфраструктурный слой в `infra/`:

- `infra/docker-compose.yml` - stack `api + web + bot`
- `infra/up.sh` - поднять стек (с автосборкой)
- `infra/down.sh` - остановить стек
- `infra/logs.sh` - смотреть логи
- `infra/health.sh` - быстрый health-check web/api/intel

Быстрый запуск:

```bash
cd /Users/biz/star-atlas-app/infra
cp .env.example .env
./up.sh
```

После запуска:

- Web: `http://127.0.0.1:5173`
- API health через web gateway: `http://127.0.0.1:5173/health`

Скрипты запускают контейнеры с `restart: unless-stopped`, поэтому сервисы автоматически перезапускаются после сбоев/рестартов Docker.

## macOS Autostart (launchd)

Добавлен набор скриптов для автозапуска Star Atlas стека после логина пользователя:

- `deploy/launchd/install_launchd_stack.sh`
- `deploy/launchd/uninstall_launchd_stack.sh`
- `deploy/launchd/restart_launchd_stack.sh`
- `deploy/launchd/status_launchd_stack.sh`

Установка и запуск:

```bash
cd /Users/biz/star-atlas-app
./deploy/launchd/install_launchd_stack.sh
```

Проверка:

```bash
./deploy/launchd/status_launchd_stack.sh
./infra/health.sh
```

Перезапуск:

```bash
./deploy/launchd/restart_launchd_stack.sh
```

Удаление:

```bash
./deploy/launchd/uninstall_launchd_stack.sh
```

Примечание: для автозапуска контейнеров Docker должен быть установлен и запущен Docker Desktop.

## API эндпоинты MVP

- GET /health
- GET /api/dashboard/:handle
- GET /api/dashboard/wallet/:wallet
- GET /api/intel/overview
- GET /api/market/settings
- PUT /api/market/settings
- GET /api/market/listings
- POST /api/market/listings
- POST /api/market/listings/:id/buy
- GET /api/market/barters
- POST /api/market/barters
- POST /api/market/barters/:id/respond

`/api/dashboard/:handle` - демо snapshot на mock-данных.

`/api/dashboard/wallet/:wallet` - реальные данные кошелька Solana (native SOL + SPL токены), с базовой USD-оценкой для известных активов (SOL/USDC/ATLAS/POLIS).

Для NFT в wallet-режиме:

- активы выводятся с классом `NFT`
- стоимость берется из Jupiter, затем fallback на Magic Eden
- принадлежность к Star Atlas определяется по `STAR_ATLAS_COLLECTIONS` (exact) и `STAR_ATLAS_COLLECTION_KEYWORDS` (вхождение)

Для market-раздела:

- торговля и обмен работают как MVP-симуляция в памяти API
- можно публиковать лоты, покупать лоты, создавать офферы обмена и отвечать на них
- поддержано подключение Solana-кошелька в web (Wallet Adapter: Phantom/Solflare)

Для intel-раздела:

- агрегируется обзор по официальному сайту, Medium, X и Discord
- формируются `highlights` и `conclusions` для итоговой аналитики
- endpoint: `GET /api/intel/overview?limit=14`

## Production Notes (API Cache)

Для снижения нагрузки и зависимости от внешних источников в API включен TTL-кеш:

- `GET /api/intel/overview` (по умолчанию 5 минут)
- `GET /api/news/archive` (по умолчанию 5 минут)

Переменные окружения:

- `INTEL_CACHE_TTL_MS` - TTL кеша intel в миллисекундах (по умолчанию `300000`)
- `NEWS_ARCHIVE_CACHE_TTL_MS` - TTL кеша архива в миллисекундах (по умолчанию `300000`)

Значение `0` отключает кеш для соответствующего endpoint.

## Production Notes (Uptime Alerts)

Для workflow [`.github/workflows/uptime-check.yml`](.github/workflows/uptime-check.yml) можно настраивать cooldown для failure-комментариев через Repository Variable в GitHub:

- `UPTIME_FAILURE_COOLDOWN_MINUTES` - интервал (в минутах), в течение которого повторный failure-комментарий не добавляется (по умолчанию `45`).

Если переменная не задана или задана некорректно, применяется безопасный fallback `45` минут.
