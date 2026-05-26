# Ordered Trades Section — Plan

## Scope

Add a third section to `DriversDashboard` so the user can spot ordered trades that need attention (update, cancel, or wait). Three artifacts wired by a shared search box: summary card, table, scatter chart. Plus a small data-layer cleanup for `date_ordered`.

---

## Part A — Data layer (foundation)

### A1. Alembic migration: backfill `date_ordered`

`backend/alembic/versions/<new>_backfill_date_ordered.py`

```sql
UPDATE trades
SET date_ordered = date_planned
WHERE date_ordered IS NULL
  AND status IN ('ordered','open','close','canceled');
```

Leave `plan` trades alone (no order yet). Downgrade is a no-op (safe — original NULLs can't be recovered, but the value is derivable).

### A2. Frontend `Trade` type + mapper

- `frontend/src/domain/trade/types.ts:19-47` — add `dateOrdered: Date | null` to the `Trade` interface, after `datePlanned`.
- `frontend/src/domain/trade/mappers.ts:60` — add `dateOrdered: parseDateOnly(dto.date_ordered)`.

No transition logic changes — `trade_service.py:152-173` already does the right thing for new transitions.

---

## Part B — Section scaffolding

### B1. Files

```
frontend/src/pages/DriversDashboard/
├── OrderedSection.tsx            # new — section wrapper, owns searchQuery state
├── OrderedSection.module.css     # new
├── OrderedSummaryCard.tsx        # new — KPIs
├── OrderedTable.tsx              # new — per-trade table
├── OrderedScatterChart.tsx       # new — bars + dots dual-axis
└── orderedSelectors.ts           # new — derive OrderedRow[] from TradeStore + LiveMetricsStore
```

### B2. `DriversDashboard.tsx` integration

Add `<OrderedSection />` after the existing `<ScopeSection scope="unrealized" />` block (keep realized → unrealized → ordered top-down ordering, since ordered is the "future" funnel). Same sticky-header conventions as `ScopeSection.tsx:79-103`.

### B3. Data selector (`orderedSelectors.ts`)

Combines three observables into a flat `OrderedRow[]`:

- `TradeStore.trades$` filtered by `status === 'ordered'`
- `LiveMetricsStore.metrics$` keyed by trade id → `currentPrice`, `distanceToPE`
- Optional radar enrichment: `tradeEta` state (`ahead` / `behind` / `on-pace` / `new`) from `domain/radar/tradeEta.ts:145-176`, plus `bullishScore` / `avgChangePct5d` from `domain/radar/types.ts` when the ticker is in the radar response. Fall back gracefully when not present.

`OrderedRow` shape:

```ts
{
  tradeId, tradeNumber, ticker, strategy,
  entryPrice, currentPrice,
  positionPct,             // distanceToPE, signed
  orderAgeDays,            // today - dateOrdered
  planAgeDays,             // today - datePlanned
  planToOrderDays,         // dateOrdered - datePlanned
  dateOrdered, datePlanned,
  amount, isLong,
  driftState,              // 'ahead' | 'behind' | 'on-pace' | 'new' | null
  bullishScore,            // 0-10 or null
  avgChangePct5d,          // or null
}
```

---

## Part C — Summary card (`OrderedSummaryCard`)

Mirrors `PortfolioCard.tsx:6-40` layout. KPIs, in order:

1. **Orders** — count + total committed capital (Σ `amount`).
2. **Avg position %** — mean `positionPct`, signed, colored by sign.
3. **Avg order age** — mean `orderAgeDays`.
4. **Closest to fill** — min `|positionPct|`, with ticker.
5. **Furthest from fill** — max `|positionPct|`, with ticker.
6. **Stale** — count where `orderAgeDays > 30` (threshold lives in the selector as a const; easy to tune later).
7. **Drifting away** — count where `driftState === 'behind'` (uses the radar/SMA5-50 baseline already wired up). This is the headline "candidates to revise/cancel" number.
8. **Aligned with trend** — count where SMA structure is bullish for longs / bearish for shorts (using `bullishScore`). Optional, only shown when radar data is available for those tickers.

Use `signClass()` (`utils/sign.ts`) for coloring.

---

## Part D — Table (`OrderedTable`)

Per-trade only (no by-ticker tab — confirmed). Reuses `SortableTh` + `useMultiSort` (`hooks/useMultiSort.ts:23-114`).

Columns (left → right):

| # | Trade # | Ticker | Strategy | PE | Current | **Position %** | **Order age** | Plan age | Plan→Order | Order date | Amount | **Drift** | SMA align |

- *Position %* = `positionPct`, colored by sign, formatted as %.
- *Order age* / *Plan age* / *Plan→Order* — reuse the formatters in `utils/trade.ts` (`formatPlanAge`, etc.); add a `formatOrderAge` if needed.
- *Drift* renders the existing `tradeEta` badge component if it's a shared component, otherwise inline pill with `ahead` / `behind` / `on-pace` / `new` styling.
- *SMA align* — small chip showing `bullishScore` / 10 or a green-up / red-down arrow.

Default sort: `positionPct` descending (matches the chart). Shift-click for multi-sort already supported.

Row click → either navigate to the trade detail or open the existing trade drawer/modal (whichever pattern is already used elsewhere — confirm during implementation).

Empty state: "No ordered trades right now." with a subtle hint about plan→order transitions.

---

## Part E — Chart (`OrderedScatterChart`)

Hand-rolled SVG + d3 scales, per `charting-approach.md` memory. Same conventions as `Histogram.tsx:32-164`.

**Layout:**

- **x-axis**: trades sorted by `positionPct` descending. One tick per trade — label = ticker (rotated 45° if > ~12 trades; truncate to 4 chars + ellipsis as a hard fallback).
- **Right y-axis** (position %): rendered as **bars**, colored by sign (green positive / red negative), origin at zero.
- **Left y-axis** (age in days): rendered as **dots** in a contrasting color (use `--color-info` from theme).
- **Legend**: top-right, two entries.

**Tooltip:**

Use `useTooltip()` + `ChartTooltip` (`components/charts/ChartTooltip.tsx:23-55`). Hit areas are transparent full-height rects per x-slot (same pattern as `MetricTimeSeriesChart.tsx:160-203`). Tooltip rows:

```
{ticker}  #{tradeNumber}
PE        {entryPrice}
Current   {currentPrice}
Position  {positionPct}    (colored)
Order age {orderAgeDays}d
Drift     {driftState}     (colored)
```

**Search highlight:** see Part F.

**Edge cases:**

- 0 trades → render "No ordered trades" centered.
- 1 trade → still render with a single bar/dot.
- Very wide spread of `positionPct` → use a symlog scale if `max/min` ratio exceeds ~50; otherwise linear. Decide at render time inside the chart.

---

## Part F — Search wiring

State lives in `OrderedSection`:

```ts
const [searchQuery, setSearchQuery] = useState('')
```

Search input sits in the section toolbar (next to the section title), placeholder: `"ticker or trade #"`. Both the table and the chart receive `searchQuery` as a prop.

**Match rule** (one helper in `orderedSelectors.ts`):

- Empty query → match all.
- Pure-digit query → exact match on `tradeNumber`.
- Otherwise → case-insensitive substring match on `ticker`.

**Table behavior:** filters rows to matches (keeps the "find a trade" feel).

**Chart behavior:** keeps all bars/dots rendered but **dims non-matches to ~25% opacity**, and applies a stronger stroke + small halo to matches. User can still hover non-matches (the tooltip remains live) — only the *visual emphasis* changes. This is what makes the chart useful for "see where in the ranking this trade sits".

---

## Part G — Ordering of work / PR strategy

Two PRs to keep review tight:

1. **PR1: `date_ordered` plumbing** — Alembic migration + frontend type + mapper. Ship and verify against the staging DB before touching UI.
2. **PR2: Ordered trades section** — selector, summary, table, chart, search. All net-new files; only touches `DriversDashboard.tsx` to slot the section in.

---

## Assumptions

- "Position %" = signed `distanceToPE` (current vs PE, as a percentage of PE).
- "Descending position %" on the chart = largest signed value first (most above PE → most below).
- Stale threshold = 30 days, configurable later.
- `tradeEta` / SMA enrichment is best-effort — if a ticker isn't in the radar response, drift/SMA columns show `—` and aren't counted in the "drifting away" KPI.
