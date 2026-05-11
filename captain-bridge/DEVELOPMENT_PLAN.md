# Captain's Bridge — Development Plan

## 📋 Overview

**Project:** Captain's Bridge (Command Center for Star Atlas DAO)  
**MVP Scope:** MVP 2 (Auth + Map + Operations)  
**Estimated Duration:** 8-12 weeks  
**Team Size:** 1-2 developers  
**Target Users:** 10 concurrent (scalable to 100+)  

---

## 🎯 MVP 2 Deliverables

✅ User authentication (wallet + allowlist + 7 roles)  
✅ Role-based access control (RBAC) with matrix  
✅ 2D top-down map (Pixi.js/Konva) with real-time fleet positions  
✅ Layer filters (Tactical, Logistics, Economy, Threat, Command)  
✅ Dashboard (NAV, ROI, member KPI, market snapshot)  
✅ Operations management (create, simulate, approve, execute)  
✅ Pre-flight simulation (ETA, risk %, profit/loss, success %)  
✅ In-app notifications (Critical/High/Normal/Info)  
✅ Operation history (30+ days archive)  
✅ Audit trail (all user actions logged)  

**NOT in MVP 2:**
- ❌ 3D map mode
- ❌ Bot management commands (read-only ok, no execute via bot)
- ❌ Advanced Monte Carlo simulations (100+ scenarios)
- ❌ AI copilot recommendations
- ❌ Discord/Telegram bot commands (only notifications)

---

## 🛣️ Development Roadmap (8 Sprints)

### Sprint 1: Auth & Foundation (Week 1-2)
**Goal:** Users can log in with correct roles, permission system active

| Task | Owner | Status | Notes |
|------|-------|--------|-------|
| Setup `/apps/captain-bridge/` project | - | TODO | New monorepo app |
| PostgreSQL schema (users, sessions, roles, audit_log) | - | TODO | migrations/ |
| Auth endpoints (challenge, verify, refresh, logout) | - | TODO | Wallet signature |
| Allowlist CSV import (Fleet Admiral) | - | TODO | POST /admin/users/import |
| Middleware: requireRole(), verifyStepUp() | - | TODO | Auth guard functions |
| Token generation & validation (15min access, 7day refresh) | - | TODO | JWT or similar |
| Session manager (multi-device control, revoke) | - | TODO | List sessions, revoke by ID |
| Frontend: Login page + wallet connect | - | TODO | Phantom, Solflare, Ledger |
| Tests: 7 roles can login, access control works | - | TODO | Integration tests |

**Definition of Done:**
- User can connect wallet → receives nonce
- User signs nonce → gets access + refresh token
- Role correctly assigned from allowlist
- Session visible to Fleet Admiral, can be revoked
- Invalid wallets get 403 Unauthorized

---

### Sprint 2: Map & Real-time Data (Week 2-3)
**Goal:** Live map displaying fleet positions, updating in real-time

| Task | Owner | Status | Notes |
|------|-------|--------|-------|
| Redis schema (fleet_state, market_state, threats) | - | TODO | Hot data cache |
| BlockchainSync worker (fetch fleets, inventory, threats from RPC) | - | TODO | 5-15s updates |
| Aggregation worker (calculate NAV, ROI, spreads) | - | TODO | 1-5min updates |
| Data endpoints: GET /map/state, GET /dashboard/nav, GET /dashboard/roi | - | TODO | Fast, from Redis |
| Frontend 2D canvas (Pixi.js or Konva.js basic setup) | - | TODO | Zoom, pan controls |
| Render fleets as dots/icons with labels | - | TODO | Click for details |
| Layer filter presets (Tactical, Logistics, Economy, Threat, Command) | - | TODO | Toggle layers |
| Custom layer toggles (own/enemy/resources/risks/routes) | - | TODO | RBAC per layer |
| Dashboard cards (NAV, ROI, member KPI snippets) | - | TODO | Live updates |
| WebSocket connection for real-time updates | - | TODO | 30-60s baseline |
| Performance test: map smooth at 60fps with 100+ fleets | - | TODO | No FPS drop |

**Definition of Done:**
- Map renders and updates without page reload
- Fleets move smoothly, position accurate within 1 block (few seconds)
- Layer presets switch instantly
- Dashboard NAV/ROI update every 5 minutes
- No performance degradation with 100 fleets

---

### Sprint 3: Operations & Simulation (Week 3-4)
**Goal:** Users can plan operations and see pre-flight estimates

| Task | Owner | Status | Notes |
|------|-------|--------|-------|
| Operations table schema (create, update, history) | - | TODO | operations, operation_history |
| Operation types enum (send_fleet, trade, recon, battle, repair, craft) | - | TODO | Switch cases |
| Simulation engine (estimate ETA, risk %, profit/loss, success %) | - | TODO | Algorithm or model |
| POST /ops/simulate endpoint | - | TODO | Stateless, returns forecast |
| POST /ops/create endpoint (submit for approval or execute) | - | TODO | RBAC checks |
| PUT /ops/:id/approve endpoint (Captain+ confirm) | - | TODO | Step-up auth |
| Frontend: Operation creation form | - | TODO | Type, fleet, destination, time |
| Pre-flight panel: Display simulation results | - | TODO | Best/worst case, risk factors |
| Parameter adjustment live-feedback | - | TODO | Re-simulate on change |
| Operation board: List pending/in-progress/completed | - | TODO | Paginated, filterable |
| Operation detail page: Full history + audit trail | - | TODO | Blockchain signature link |
| Tests: Simulation reasonable, approval flow works | - | TODO | Unit + integration |

**Definition of Done:**
- User can create operation, get simulation in < 1 second
- Pre-flight shows: ETA, risk %, profit (best/worst), success %
- Changing parameter re-simulates instantly
- Captain+ can approve critical operation with step-up auth
- Operation transitions pending → approved → in_progress → completed

---

### Sprint 4: Notifications & Audit (Week 4-5)
**Goal:** Critical events trigger notifications, all actions logged

| Task | Owner | Status | Notes |
|------|-------|--------|-------|
| Notifications table schema (events, delivery status) | - | TODO | notifications, audit_log |
| Notification worker (detect critical events, route by role) | - | TODO | Event-driven |
| In-app notification delivery (store in DB, push via WebSocket) | - | TODO | Real-time feed |
| Audit log table + middleware (log all user actions) | - | TODO | WHO, WHAT, WHEN |
| GET /notifications endpoint (fetch feed, paginated) | - | TODO | Unread count |
| POST /notifications/:id/acknowledge endpoint | - | TODO | Mark as read |
| GET /admin/audit-log endpoint (Fleet Admiral only) | - | TODO | Filter by user, action, date |
| Frontend: Notifications bell + dropdown feed | - | TODO | Unread badge |
| Notification badges (red=Critical, orange=High, etc.) | - | TODO | Color coding |
| Sound alert for Critical events (user opt-in) | - | TODO | Settings toggle |
| Notification settings page (opt-out from Info/Normal) | - | TODO | Per event type |
| Tests: Events trigger correct notifications, audit complete | - | TODO | Mock blockchain |

**Definition of Done:**
- Critical events (fleet loss, risk zone) → notification within 2 seconds
- User sees notification in bell dropdown
- Fleet Admin can review all actions in audit log
- User can opt-in/out of Info-level notifications
- Critical events cannot be opt-out

---

### Sprint 5: History & Role-based Views (Week 5-6)
**Goal:** Users see appropriate data per role, full operation history

| Task | Owner | Status | Notes |
|------|-------|--------|-------|
| Data filtering middleware per role | - | TODO | Apply to all endpoints |
| GET /history/operations endpoint (30+ days archive) | - | TODO | Paginated, filterable |
| GET /metrics/{role} endpoint (role-specific KPI) | - | TODO | Captain sees captains ops, Ensign sees assigned |
| Frontend: History filter (date, type, commander, status) | - | TODO | Advanced search |
| Member KPI drill-down (profit by member, period) | - | TODO | Contribution leaderboard |
| Role-based dashboard layouts | - | TODO | Captain ≠ Ensign view |
| Role-based map layers (hide enemy fleets from Logistics, etc.) | - | TODO | RBAC per layer |
| Tests: Analyst cannot see realtime positions, Ensign cannot see Admiral ops | - | TODO | Access control |

**Definition of Done:**
- Analyst sees historical data, not live positions
- Ensign sees only assigned operations
- Captain sees all fleets, not private plans
- Dashboard reflects role (Captain tactical, Analyst historical)
- No unauthorized data leakage

---

### Sprint 6: Operations Executor & Status (Week 6-7)
**Goal:** Operations execute on blockchain, status updates in real-time

| Task | Owner | Status | Notes |
|------|-------|--------|-------|
| Operations executor worker | - | TODO | Monitor blockchain |
| POST /ops/:id/blockchain-confirm endpoint | - | TODO | Receive tx signature |
| Calculate actual profit/loss from blockchain results | - | TODO | Compare to forecast |
| Operations monitoring page (live progress bar) | - | TODO | ETA countdown |
| Blockchain signature links (to Solscan) | - | TODO | Click to explorer |
| Failed operation handling (retry logic) | - | TODO | Error messages |
| Post-operation review (actual vs forecast) | - | TODO | Analysis |
| Tests: Operation lifecycle end-to-end | - | TODO | Mocked blockchain |

**Definition of Done:**
- Operation submitted → blockchain tx sent → status updated in DB → user sees progress
- On completion: actual profit/loss calculated and displayed
- User can view blockchain tx on Solscan
- Failed ops show clear error, can retry or cancel

---

### Sprint 7: Polish & Performance (Week 7-8)
**Goal:** UI smooth, optimized, production-ready

| Task | Owner | Status | Notes |
|------|-------|--------|-------|
| Map performance test (100+ fleets at 60fps) | - | TODO | Profile, optimize |
| Redis cache tuning (TTL, eviction) | - | TODO | Correct cache invalidation |
| Pagination for history (50 per page, infinite scroll) | - | TODO | Memory efficient |
| Graceful degradation (blockchain unavailable) | - | TODO | Show stale cache + notice |
| Loading states (spinners, skeletons) | - | TODO | UX polish |
| Mobile responsive design (map, forms) | - | TODO | Touch gestures |
| Accessibility (keyboard nav, screen reader labels) | - | TODO | WCAG AA |
| Security audit (token, rate limit, input sanitization) | - | TODO | Penetration testing |
| Load testing (10 concurrent users, measure latencies) | - | TODO | Performance SLA check |
| Error boundary & crash recovery | - | TODO | Sentry integration |
| Documentation (API, user guide, admin guide) | - | TODO | Markdown |

**Definition of Done:**
- All critical user paths work (login → map → operation → history)
- Map smooth at 60fps, no janky animations
- API p95 < 300ms (hot queries from cache)
- No unhandled crashes logged to Sentry
- Mobile works on iPad/tablet

---

### Sprint 8: Deployment & Go-live (Week 8)
**Goal:** System live, monitored, team ready

| Task | Owner | Status | Notes |
|------|-------|--------|-------|
| Deploy PostgreSQL to Railway | - | TODO | Managed DB |
| Deploy Redis to Railway | - | TODO | Managed cache |
| Deploy Fastify API to Railway | - | TODO | Container |
| Deploy React frontend to Railway/Vercel | - | TODO | Static site |
| Environment variables (.env setup) | - | TODO | Secrets in Railway |
| Monitoring & alerts (Sentry, custom dashboards) | - | TODO | Error tracking |
| Structured logging (cloud provider) | - | TODO | Log aggregation |
| PostgreSQL backup strategy (daily) | - | TODO | Data safety |
| SSL/HTTPS setup | - | TODO | Security |
| Go-live checklist (health checks, warmup) | - | TODO | Pre-flight |
| Team training session | - | TODO | How to use |

**Definition of Done:**
- API and web accessible from internet
- Health endpoint returns ok
- All critical endpoints have < 2s p95 latency
- Errors logged to Sentry in real-time
- Daily database backups running

---

## 📦 Project Structure

```
/Users/biz/star-atlas-app/
├── apps/
│   ├── api/
│   │   └── src/
│   │       └── modules/
│   │           └── captainBridge/
│   │               ├── auth.ts (login, challenge, verify, allowlist)
│   │               ├── roles.ts (RBAC, matrixData)
│   │               ├── map.ts (fleet state, layers)
│   │               ├── operations.ts (create, simulate, approve)
│   │               ├── notifications.ts (events, delivery)
│   │               ├── audit.ts (logging middleware)
│   │               ├── admin.ts (Fleet Admiral endpoints)
│   │               └── workers/ (sync, aggregation, notifications, executor)
│   │
│   ├── web/
│   │   └── src/
│   │       └── pages/captainBridge/
│   │           ├── Login.tsx
│   │           ├── Map.tsx (2D canvas)
│   │           ├── Dashboard.tsx
│   │           ├── Operations.tsx (create, list, detail)
│   │           ├── History.tsx (archive)
│   │           ├── Notifications.tsx (feed)
│   │           └── Admin.tsx (Fleet Admiral)
│   │
│   └── bot/
│       └── src/
│           └── modules/captainBridge/
│               ├── commands.ts (/status, /fleet, /ops, /risk, etc.)
│               └── notifications.ts (Discord/Telegram delivery)
│
├── packages/
│   └── shared/
│       └── src/
│           └── captainBridge/
│               ├── types.ts (Role, Operation, Notification enums)
│               └── validators.ts
│
└── captain-bridge/
    ├── QA.md (requirements, filled)
    ├── ARCHITECTURE.md (system design)
    ├── DEVELOPMENT_PLAN.md (this file)
    ├── DATABASE_SCHEMA.sql (migrations)
    └── API_REFERENCE.md (endpoint documentation)
```

---

## 🔧 Tech Stack

### Frontend
- **React 19** + TypeScript + Vite
- **Pixi.js** or **Konva.js** (2D canvas rendering)
- **Zustand** or **Jotai** (state management)
- **React Query** (server state)
- **Tailwind CSS** (styling)
- **WebSocket** (real-time updates)

### Backend
- **Fastify 5** + TypeScript
- **PostgreSQL** (history, audit, operations)
- **Redis** (hot data, sessions, cache)
- **@solana/web3.js** (blockchain RPC)
- **Bull** or **Bullmq** (job queue for workers)
- **Winston** or **Pino** (structured logging)
- **Jest** (testing)

### DevOps
- **Docker** (containerization)
- **Railway** (deployment: API, web, DB, Redis)
- **GitHub Actions** (CI/CD)
- **Sentry** (error tracking)
- **Grafana** optional (monitoring dashboards)

---

## 📊 Success Metrics

### Performance
- ✅ Map renders 100+ fleets at 60fps
- ✅ API p95 < 300ms (hot queries from cache)
- ✅ Real-time map updates within 60 seconds baseline
- ✅ Operation simulation < 1 second
- ✅ 99.5% uptime

### Usability
- ✅ New user can login + view map in < 2 minutes
- ✅ Create operation + simulate in < 30 seconds
- ✅ Navigate between tabs instant (no page reload)
- ✅ Notifications arrive within 2 seconds of event

### Reliability
- ✅ Zero data loss (PostgreSQL ACID)
- ✅ All user actions audit-logged
- ✅ Graceful fallback when blockchain unavailable
- ✅ < 0.1% user-reported errors (Sentry)

---

## 🚦 Dependencies & Critical Path

### Critical Path (blocks others):
1. **Auth** (Sprint 1) → Everything needs verified user
2. **PostgreSQL schema** (Sprint 1) → All services depend
3. **BlockchainSync worker** (Sprint 2) → Data source for map
4. **Data endpoints** (Sprint 2) → Frontend needs API
5. **Operations engine** (Sprint 3) → Core business logic

### Parallel Tracks:
- Frontend UI (Sprints 2-5) can start once API contracts are defined
- Worker development (Sprints 2-6) can start once DB schema is ready
- Testing (all sprints) runs continuously

### Can Slip to 2.0:
- 3D map mode
- Bot management commands (execute via Discord)
- Advanced Monte Carlo (100+ scenarios)
- AI recommendations

---

## 📝 Documentation Checklist

- [ ] API reference (all endpoints, request/response examples)
- [ ] Database schema (tables, relationships, indices)
- [ ] Environment setup (local dev, staging, production)
- [ ] User guide (how to use each role)
- [ ] Admin guide (manage users, view audit log)
- [ ] Troubleshooting (common errors, recovery)
- [ ] Deployment guide (Docker, Railway, backups)

---

## ✅ Approval & Sign-off

| Role | Name | Date | Status |
|------|------|------|--------|
| Product | - | - | ⏳ Pending |
| Tech Lead | - | - | ⏳ Pending |
| Security | - | - | ⏳ Pending |
| DevOps | - | - | ⏳ Pending |

---

## 🎯 Next Steps

1. **Review this plan** with stakeholders
2. **Finalize tech stack** (Pixi vs Konva, PostgreSQL hosting details)
3. **Create GitHub issues** for each sprint task
4. **Set up project tracking** (GitHub Projects or Jira)
5. **Begin Sprint 1** (Auth & Foundation)

---

## 📞 Contact & Questions

**Slack channel:** #captain-bridge-dev  
**Status updates:** Mondays 10am UTC  
**Blockers:** Report immediately  

---

**Last Updated:** May 10, 2026  
**Next Review:** After Sprint 1 (Week 2)
