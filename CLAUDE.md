# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is this project?

AsisTrader is a trading operations management system (migrated from Excel). It tracks trades through their lifecycle: plan → open → close, with support for layered exit levels (multiple SL/TP targets at different price levels with percentage-based position sizing).

## Commands

### Backend (from `backend/`)
```bash
uv pip install -e ".[dev]"          # Install dependencies
uvicorn asistrader.main:app --reload # Dev server (port 8000)
pytest                               # Run all tests
pytest tests/test_services/test_trade_service.py -k "test_name"  # Single test
alembic upgrade head                 # Run migrations
alembic revision --autogenerate -m "description"  # Create migration
```

### Frontend (from `frontend/`)
```bash
npm install        # Install dependencies
npm run dev        # Dev server (Vite, port 5173)
npm test           # Run tests (Vitest, watch mode)
npm run build      # Type-check + build
npm run check-types # TypeScript check only
```

### Database
```bash
docker-compose -f docker-compose.dev.yml up -d  # Start PostgreSQL
python scripts/seed_data.py                       # Seed sample data
```

## Architecture

### Backend (`backend/src/asistrader/`)
- **FastAPI** app with routers in `api/` (trades, tickers, strategies, market_data, auth)
- **SQLAlchemy** models in `models/db.py`, **Pydantic** schemas in `models/schemas.py`
- **Services** layer (`services/`) contains business logic — API routes delegate to services
- **Auth**: JWT-based (access + refresh tokens) in `auth/` module, dependency injection via `auth/dependencies.py`
- Tests use in-memory SQLite via `conftest.py` fixtures (`db_session`, `client`, `auth_headers`)

### Frontend (`frontend/src/`)
- **Domain-driven** structure: each domain (`trade/`, `ticker/`, `strategy/`, `marketData/`) has its own repository interface, HTTP implementation, types, and mappers
- **Repository pattern**: `ITradeRepository` interface → `HttpTradeRepository` implementation. Mappers convert API DTOs to domain types (handling `snake_case` → `camelCase`)
- **Stores**: `TradeStore` and `TickerStore` manage state using `@legendapp/state` (observable state)
- **LiveMetricsStore**: fetches live prices and computes real-time P&L metrics
- **Container pattern**: `AppContainer` wires up all repositories and stores, provided via React context (`ContainerContext`)
- **Decimal handling**: `big.js` via `domain/shared/Decimal.ts` for precise financial calculations
- **Styling**: CSS Modules (`.module.css` files co-located with components)

### Key domain concepts
- **Trade lifecycle**: plan → open → close. Trades have exit levels (SL/TP) that can be simple (one SL + one TP) or layered (multiple TP levels with `units_pct` allocations)
- **ExitLevel**: each level has `level_type` (sl/tp), `price`, `units_pct` (0-1), `order_index`, `status` (pending/hit/cancelled), and optional `move_sl_to_breakeven`
- **SL/TP detection** (`sltp_detection_service.py`): compares market data against exit levels to auto-detect hits; supports both long and short trades
- **Trade.stop_loss/take_profit** are computed properties on the SQLAlchemy model, derived from exit_levels (not stored columns)

## Agent skills

### Issue tracker

Issues and specs are tracked in GitHub Issues on `ferpar/asistrader` via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` plus `docs/adr/`. See `docs/agents/domain.md`.
