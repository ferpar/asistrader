# MCP Integration Plan

End goal: the user's AI acts as an intermediary between AsisTrader and TradingView, on the user's behalf. This document plans the AsisTrader side of that integration — a shared TypeScript package of pure derivations plus a headless Node MCP server that consumes it.

## Session of origin (for resuming this work later)

Drafted with Claude (Opus 4.7, 1M context) on 2026-05-27. The conversation explored several architectures before landing here. A future session can pick up from this summary without re-deriving the reasoning:

**Goal stated by user:** "users to be able to steer the app via their AI; my end goal is for the AI to act as an intermediary between this and the TradingView app in behest of the user."

**Path considered and chosen:** shared TS package of pure derivations + headless Node MCP server (this plan).

**Paths considered and deferred:**

- **WebMCP layer in the SPA.** Valuable for the "verbal driving with visible actions" copilot UX (AI manipulates the UI the user is looking at, can read on-screen state like current filter / selection / open modal). Deferred because (a) it requires a host or browser-extension bridge that doesn't exist for this stack today, and (b) once the shared package exists, building WebMCP later becomes cheaper since it imports the same derivations. **Complementary, not redundant** — keep on the roadmap.
- **TradingView webhook ingestion** (TradingView Alerts → FastAPI). Useful for unattended reactions when the AI isn't in-session. Not foundational once the TradingView MCP is in place; add later if needed.

**Paths considered and rejected:**

- **Port `domain/` derivations to Python** so a Python MCP could be complete. Rejected — duplicates the source of truth, drift guaranteed, wrong direction for business logic that's already working in TS.
- **Browser-automating TradingView via Playwright.** Rejected — superseded by community CDP-based TradingView MCP servers (see below).
- **Backend MCP as thin pass-through of FastAPI without derivations.** Rejected — would force the AI to crunch raw rows for things the UI already computes, and most interesting answers (driver scores, IRR, radar rankings) need the derivations.

**Key external finding:** The user pointed out that `tradesdontlie/tradingview-mcp` (and several siblings: `LewisWJackson/tradingview-mcp-jackson`, `fiale-plus/tradingview-mcp-server`, etc.) already solve the TradingView side via Chrome DevTools Protocol against TradingView Desktop on `localhost:9222`. ~78 tools including chart reads, indicator values (`data_get_study_values`), alert CRUD (`alert_create/list/delete`), drawing, replay-mode sims. This means the AsisTrader MCP only needs to cover AsisTrader; TradingView is a free dependency.

**Codebase facts verified during the session** (re-verify before acting if the code has moved on):

- `frontend/src/domain/` is organized hexagonally: `compute*.ts` / `stats.ts` / `indicators.ts` / `tradeEta.ts` / `filterSort/*` / `mappers.ts` / `types.ts` are pure (no React, no Legend-state, no DOM); `*Store.ts` files hold UI state via `@legendapp/state`; `Http*Repository.ts` are I/O behind `I*Repository.ts` interfaces.
- `computeBalance` in `domain/fund/computeBalance.ts` takes a concrete `FxStore` — needs an `IFxStore` interface extracted before the package move.
- Backend is FastAPI with routers: `auth`, `fund`, `trades`, `tickers`, `strategies`, `market_data`, `benchmarks`, `fx`, `irr`, `radar_presets`.
- Frontend pages: `TradeDashboard`, `FundDashboard`, `RadarDashboard`, `DriversDashboard`, `DetectionSandbox`.

### Re-verification on 2026-05-31 (before starting Phase 1)

Re-ran the audit against current `worktree-1`. Confirmed the above, plus three findings that change the Phase 1 scope:

1. **`domain/` is not a closed dependency set.** The pure modules import across two folder boundaries the original tree ignored:
   - **`frontend/src/types/*`** — every `mappers.ts` and `I*Repository.ts` imports DTOs from `../../types/{trade,fund,radar,radarPreset,fx,ticker,strategy,benchmark,marketData,auth}` (the `types/` folder is *exactly* these 10 files). All verified free of React/Legend.
   - **`frontend/src/utils/{timelineExpectations,trade}.ts`** — `radar/tradeEta.ts` and `radar/filterSort/{filters,sort}.ts` import them. Both verified pure; they import *from* `domain/`, so the dependency points inward.
   These must move into the package too, or the move won't compile. Hence the package gains `dto/` and `util/` subfolders (see revised Phase 1 layout).
2. **`IFxStore` is a one-method interface.** `computeBalance` calls only `fxStore.convert(amount, from, to, onDate)` and already guards `fxStore | null`. The interface is `{ convert(amount: Decimal, from: string, to: string, onDate: Date): Decimal | null }`; the frontend's concrete `FxStore` satisfies it structurally.
3. **Import-rewrite blast radius:** ~61 frontend files import from `domain/`, 45 import the moved DTOs, 7 import the moved utils (~80 distinct files of 201). All `I*Repository.ts` confirmed frontend-agnostic. `tsc` (`npm run check-types`) is the safety net for the rewrite.

Frontend build facts: no root `package.json`/workspaces yet; frontend is `type: module`, `moduleResolution: bundler`, `allowImportingTsExtensions: true`, no path aliases; Vite proxies `/api` → `localhost:8005`. Package will be consumed **as TS source** via an `exports` map (`./*` → `./src/*.ts`) — Vite/esbuild and bundler-resolution `tsc` both handle raw `.ts`; a real build step is deferred to Phase 2 when the Node server needs compiled JS.

**Open questions resolved:**

- ✅ `I*Repository.ts` interfaces audited — all 10 import only plain DTOs + domain types, no React/Legend/Vite. No narrowing needed.
- ✅ Auth model decided: a dedicated **`api_keys` table** (see revised Phase 3), not a long-TTL JWT.

## Context

The TradingView side is already covered by community MCP servers that connect to TradingView Desktop via Chrome DevTools Protocol (e.g. `tradesdontlie/tradingview-mcp`), exposing ~78 tools: chart reads, indicator values, alert CRUD, drawing, replay sims. Once AsisTrader has its own MCP, the AI can orchestrate between both from any MCP-capable client (Claude Desktop, Claude Code, etc.).

The architectural insight that shapes this plan: much of AsisTrader's *computed truth* (driver-weighted scores, IRR, radar rankings, FX-normalized P&L, trade liveness) lives in `frontend/src/domain/` as TypeScript. A Python backend MCP would either reimplement all of it (drift guaranteed) or return raw rows the AI has to crunch itself. Extracting the pure modules into a shared package lets both the browser and a Node MCP run the exact same code.

Existing structure already supports this cleanly. Per-domain split:

- **Pure derivation modules** (no React, no Legend-state, no DOM): `trade/computeMetrics.ts`, `fund/computeBalance.ts`, `irr/stats.ts`, `radar/indicators.ts`, `radar/tradeEta.ts`, `radar/filterSort/*`, `shared/Decimal.ts`, every `mappers.ts` and `types.ts`.
- **State-coupled**: only `*Store.ts` files (`TradeStore`, `FundStore`, etc.) — hold UI/filter/loading state, not math.
- **I/O**: `Http*Repository.ts`, behind `I*Repository.ts` interfaces.

## Phase 1 — Package extraction (~1 day)

Set up npm workspaces at the repo root (no new tooling needed) with this layout:

```
asistrader/
├── frontend/
├── backend/
├── packages/
│   └── domain/                    # new — @asistrader/domain
│       ├── package.json           # type: module, exports map (./* → ./src/*.ts)
│       ├── tsconfig.json          # strict, ESM, no DOM lib
│       └── src/
│           ├── shared/Decimal.ts
│           ├── dto/*              # ← frontend/src/types/* (10 DTO modules, pure)
│           ├── util/{timelineExpectations, trade}.ts   # ← frontend/src/utils/* (pure)
│           ├── trade/{computeMetrics, mappers, types, ITradeRepository}.ts
│           ├── fund/{computeBalance, mappers, types, IFundRepository}.ts
│           ├── irr/{stats, types, IIrrRepository}.ts
│           ├── radar/{indicators, tradeEta, convergenceScore, types, IRadarRepository, IRadarPresetRepository}.ts
│           ├── radar/filterSort/*
│           ├── benchmark/{types, IBenchmarkRepository}.ts
│           ├── strategy/{types, mappers, IStrategyRepository}.ts
│           ├── ticker/{types, mappers, ITickerRepository}.ts
│           ├── marketData/{types, mappers, IMarketDataRepository}.ts
│           └── fx/{types, currencies, IFxStore, IFxRepository}.ts   # extract IFxStore (convert only)
```

Internal package layout keeps the domain subfolders at the package root so sibling relative imports (`../shared/Decimal`, `../trade/types`) stay byte-identical; only the `types/*`→`dto/*` and `utils/*`→`util/*` references are rewritten.

Steps:

1. Add `"workspaces": ["frontend", "packages/*", "mcp-servers/*"]` to a new root `package.json`.
2. `git mv` the pure modules in (preserves history). Stores, repos' HTTP implementations, React, and hooks all stay in `frontend/`.
3. Replace frontend imports: `'../../domain/trade/computeMetrics'` → `'@asistrader/domain/trade/computeMetrics'`. Mechanical find-and-replace.
4. Verify with frontend's existing `vitest`, `check-types`, and `build` — no behavior change.

One thing to inspect first: `computeBalance` takes `FxStore | null`. Extract a minimal `IFxStore` interface (`convert(amount, from, to, atDate) → Decimal | null`) into the package so the Node MCP can supply its own implementation without dragging Legend-state in.

## Phase 2 — Node MCP server (~1–2 days)

```
mcp-servers/
└── asistrader/
    ├── package.json               # bin entry for npx invocation
    ├── tsconfig.json
    └── src/
        ├── server.ts              # MCP SDK setup, transport, tool registry
        ├── tools/
        │   ├── trades.ts          # list/get/create/update/close
        │   ├── fund.ts            # balance, events
        │   ├── radar.ts           # view, indicators
        │   ├── irr.ts
        │   └── tickers.ts
        ├── repos/                 # Node implementations of I*Repository
        │   ├── tradeRepo.ts       # wraps fetch against FastAPI
        │   ├── fundRepo.ts
        │   ├── fxStore.ts         # implements IFxStore via /api/fx
        │   └── ...
        ├── auth.ts                # Authorization: Bearer forwarding
        └── config.ts              # env: ASISTRADER_API_BASE, ASISTRADER_TOKEN
```

Stack: `@modelcontextprotocol/sdk` (official TS), Zod for schemas, built-in `fetch`. Transport: stdio for Claude Desktop, HTTP/SSE optional for web clients — both come from the SDK.

### v1 tool surface

Read-heavy, layered on the package's pure functions.

Read:

- `list_trades({status?, ticker?})` — pass-through
- `get_trade(id)` — pass-through + optional `computeMetrics` if `currentPrice` supplied
- `get_fund_balance({baseCurrency?})` — fund events → `computeBalance`
- `get_radar_view({presetId})` — radar data → `filterSort` + `indicators` + `tradeEta`
- `get_ticker_indicators({symbol, period?})` — closes → `indicators.computeSmaStructure` etc.
- `get_irr_stats({scope})` — IRR series → `stats.mean/stdDev/histogramBins`
- `list_tickers()`, `get_ticker(symbol)`, `get_drivers()`, `list_strategies()`, `list_radar_presets()`

Write:

- `create_trade(...)`, `update_trade(id, patch)`, `close_trade(id, {exitType, exitPrice, exitDate})`
- `sync_market_data({symbols})`

Pattern per tool: validate with Zod → call appropriate `repos/*` → run any pure derivation from `@asistrader/domain` → return JSON. Most tools end up ~15 lines.

## Phase 3 — Auth & distribution (~half day)

- **Auth v1 (decided 2026-05-31):** a dedicated **`api_keys` table** rather than a long-TTL JWT. Current auth is stateless 15-min access tokens + 7-day DB refresh tokens; minting a multi-month JWT would leave an un-revocable bearer token in a config file. The `api_keys` table (`id`, `user_id`, `name`, `key_hash`, `created_at`, `last_used_at`, nullable `revoked_at`) is accepted on the same `Authorization: Bearer` path as access tokens. User logs into the SPA once, creates a named key on a new "API tokens" settings page, copies it (shown once), pastes into Claude Desktop MCP config as `ASISTRADER_TOKEN`. Revoke = set `revoked_at`. Barely more code than widening the TTL, and it gives the name/revoke UX the settings page needs anyway.
- **Distribution:** `bin: "./dist/server.js"` in the MCP server package; users run it via either a local path in their MCP config (`node /path/to/mcp-servers/asistrader/dist/server.js`) or, later, `npx @asistrader/mcp-server` if published.
- **Smoke test:** a single `tests/e2e.ts` that boots FastAPI, starts the MCP server in stdio mode, sends `tools/list` and one `tools/call`, asserts shape.

## Tradeoffs worth knowing now

- **Workspaces touches the frontend build.** Vite usually resolves workspace packages cleanly, but expect ~an hour of `tsconfig` / `vite.config` fiddling to get path resolution right.
- **`I*Repository` shape constraint.** Currently they may reference frontend-only types; quick audit needed before moving them. If anything ties to React or Legend-state types, narrow the interface before the move.
- **Auth UX is the rough edge.** Pasting a JWT works but isn't great; the "API tokens" page is small but real product surface — worth planning for v1, not v2.
- **Stay disciplined about what's "pure."** Once the package exists, the rule *"pure modules import only from `shared/` and each other"* needs to hold or the Node runtime breaks. Worth a small lint rule (`eslint-plugin-import` with `no-restricted-imports` for `react`, `@legendapp/state`, `vite/*` inside `packages/domain`).

## What this gets you when done

- AsisTrader steerable from Claude Desktop / Claude Code, calling the same derivations the UI uses.
- TradingView MCP + AsisTrader MCP both loaded → AI orchestrates between them headlessly.
- The future WebMCP path remains open and is now cheaper to build — it would import from the same package.

## Out of scope (deliberately)

- **WebMCP layer in the SPA.** Complementary to this plan, but a separate workstream. Add once the headless surface is proven and you want the verbal-driving copilot UX with visible actions.
- **TradingView outbound automation.** Already solved by community MCP servers via Chrome DevTools Protocol against TradingView Desktop. No reason to reinvent.
- **TradingView webhook ingestion.** Useful for unattended reactions when the AI isn't sitting in a session, but not foundational. Add later if needed.
- **Porting derivations to Python.** Explicitly rejected — duplicates the source of truth and forces drift.
