# Captain's Bridge — ARCHITECTURE (Draft v0.1)

## 1. Цель системы
Captain's Bridge — приватный командный центр одной ДАК для:
- владения актуальной информацией по флотам, ресурсам и рынку;
- анализа состояния и рисков;
- выдачи рекомендаций для всей ДАК и отдельно по ролям.

Ключевая цель: быстрое и обоснованное принятие решений Fleet Admiral, Admiral, Captain и Specialist-ролями.

## 2. Контекст и ограничения
- Аудитория: 10 одновременных пользователей сейчас, рост до 100+ в одной ДАК.
- Модель владения: одна приватная ДАК.
- Источники данных: Solana RPC + Sage Labs API (если доступен).
- Карта: полный охват Star Atlas, основной режим 2D top-down, 3D только опционально.
- Реалтайм: база 30-60 сек, горячие зоны 5-15 сек, временный boost до 1 сек (2-5 мин).

## 3. Архитектурные принципы
- Security-first: строгий allowlist, подпись кошельком, RBAC, аудит.
- Role-aware UX: каждый ранг видит только релевантные данные и рекомендации.
- Event-driven + cache-first: события и горячие срезы обновляются быстрее, тяжелая аналитика асинхронно.
- Degrade gracefully: при проблемах внешних API система работает на кэше и сообщает об устаревании.
- Эволюция без ломки: MVP с возможностью расширения до прогнозных моделей и bot-управления.

## 4. Высокоуровневая схема

```text
[Solana RPC]         [Sage Labs API]
     |                     |
     +----------+----------+
                |
        [Ingestion Workers]
                |
     +----------+-----------+
     |                      |
[PostgreSQL: history]   [Redis: hot cache]
     |                      |
     +----------+-----------+
                |
            [API Layer]
      (RBAC, Ops, Analytics,
       Recommendations)
                |
     +----------+------------+
     |                       |
 [Web UI: Captain Bridge]  [Bot Bridge]
 (map, ops, insights)      (Discord/Telegram)
```

## 5. Компоненты

### 5.1 Ingestion Workers
Назначение:
- сбор позиций флотов, инвентаря, ордеров, статусов крафта;
- нормализация и запись в БД;
- обновление hot-кэша.

Периодичность:
- критичные сущности: 5-15 сек;
- обычные срезы: 30-60 сек;
- агрегаты/пересчеты: 1-5 мин;
- дневные отчеты: 1 раз в сутки.

### 5.2 API Layer (расширение apps/api)
Назначение:
- единая точка доступа для web и bot;
- RBAC/ABAC-проверки;
- операции, симуляции, аналитика, рекомендации;
- аудит действий.

Предлагаемые домены API:
- auth: wallet challenge/sign-in/session;
- assets: fleets/resources/inventory/market;
- map: layers, filters, hot zones, trails;
- ops: create/plan/approve/execute/cancel;
- sim: risk, ETA, pnl, scenario probabilities;
- insights: KPI, NAV, ROI, anomalies;
- notifications: feed, ack, escalation.

### 5.3 Data Stores
PostgreSQL (история, связь сущностей, аудит):
- users, wallets, roles, role_assignments;
- fleets, fleet_positions, fleet_events;
- resources, inventories, market_orders;
- operations, operation_steps, operation_results;
- simulations, simulation_runs;
- alerts, alert_deliveries;
- audit_log.

Redis (горячие данные):
- live map layers;
- current fleet status;
- latest market snapshot;
- session/nonce/challenge;
- short-lived recommendation payloads.

### 5.4 Web UI (расширение apps/web)
Назначение:
- 2D command map;
- ролевые пресеты: Tactical, Logistics, Economy, Threat, Command;
- центр операций: план, риск, подтверждение, запуск;
- role-aware рекомендации и alert feed.

### 5.5 Bot Bridge (расширение apps/bot)
Назначение:
- доставка событий и сводок;
- read-only команды в MVP;
- управляемые команды после hardening (Phase 2).

## 6. Модель ролей и доступа
Утвержденная иерархия:
1) Fleet Admiral
2) Admiral
3) Captain
4) Chief Specialist
5) Specialist (Logistics / Analyst / Trader / Scout)
6) Ensign
7) Allied Observer

Правила:
- добавление пользователей только Fleet Admiral;
- строгий allowlist кошельков;
- одна активная роль на сессию;
- временные роли с auto-expiry;
- аудит каждой операции с отметкой активной и primary роли.

## 7. Операционный контур (MVP)
Фокус MVP: отправка флота и торговля.

Шаблон выполнения операции:
1. Create draft (Captain+).
2. Pre-flight simulation:
   - шанс успеха;
   - ETA;
   - ожидаемый PnL;
   - worst/best case;
   - риск-факторы.
3. Policy checks (RBAC + ограничения ранга).
4. Confirm critical action (для риск-сценариев).
5. Execute.
6. Track + alerts.
7. Post-action review (факт vs прогноз).

## 8. Рекомендательный слой
Рекомендации генерируются по роли:
- Fleet Admiral: стратегические риски, готовность к расширению, баланс риска/доходности;
- Admiral/Captain: приоритизация операций, bottlenecks, эскалации;
- Logistics: оптимизация маршрутов и загрузки;
- Analyst: аномалии, тренды, confidence;
- Trader: арбитраж/спреды, ликвидность, сигнал входа/выхода.

Формат рекомендации:
- заголовок действия;
- причина (данные/метрика);
- ожидаемый эффект;
- confidence score;
- TTL рекомендации.

## 9. Надежность и безопасность
- Wallet challenge-response (nonce + подпись).
- Короткоживущие сессии + ротация refresh.
- Rate limit и anti-replay для auth.
- Полный audit trail по действиям и командам.
- Graceful degradation при сбое источников:
  - показ stale-данных с timestamp;
  - retry/backoff;
  - alert ответственным ролям.

## 10. Нефункциональные требования (целевые)
- API p95 < 300 ms для hot endpoints из кэша.
- API p95 < 1200 ms для тяжелых аналитических запросов.
- Доступность основных read-сценариев >= 99.5%.
- Поддержка 100+ одновременных пользователей в рамках одной ДАК.

## 11. Roadmap

### Phase A (MVP Foundation, 3-4 недели)
- wallet auth + allowlist + RBAC;
- ingestion workers базового набора;
- 2D map + role filters;
- операции: отправка флота, торговля (draft + execute);
- audit log.

### Phase B (Operational Intelligence, 3-4 недели)
- pre-flight simulation v1;
- alert feed + ack/escalation;
- KPI/NAV/ROI dashboards;
- post-operation review.

### Phase C (Command Maturity, 2-4 недели)
- bot integration (read-only);
- расширенные сценарии симуляции;
- recommendation tuning по ролям;
- hardening и нагрузочные тесты.

## 12. Решения, ожидающие фиксации в QA
Ниже блоки, которые нужно закрыть перед final architecture v1:
- раздел 6: политика уведомлений и эскалаций;
- раздел 7: объем bot-функций в MVP;
- раздел 8: финальная политика сессий и step-up security;
- раздел 9: окончательный выбор MVP (чекбокс + состав);
- раздел 10: окончательное решение по PostgreSQL/Redis/workers и SLO.

## 13. Предложение по структуре внедрения в текущий репозиторий
- apps/api/src/modules/captainBridge/*
- apps/web/src/captainBridge/*
- apps/bot/src/captainBridge/*
- packages/shared/src/captainBridge/*
- captain-bridge/ (документация и решения)

Это позволит не ломать текущий MVP и развивать новый блок модульно.
