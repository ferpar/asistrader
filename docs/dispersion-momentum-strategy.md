# Dispersion-and-Momentum Strategy — Locked Design

Second automated strategy. Generalizes the `historical_expected_days` (HED) sweep so a
single executable core serves **both** strategies, configured differently. Long-only
focus to start; entry via limit or stop. See [`automated-strategies.md`](./automated-strategies.md)
for the shared infrastructure and the HED v1.

## Decision summary

- **One engine core, two engine *schemas*.** A `Strategy` binds to an engine purely via
  `params.engine` (a string). An "engine" in `engines.py` is just a named param schema +
  defaults — it carries no code. So we register a second schema, `dispersion_momentum`,
  beside `historical_expected_days`; both route into the same generalized sweep/recommend.
- **Backward compatible, no DB migration.** Existing HED rows keep
  `engine="historical_expected_days"` and behave identically. New strategy is a seeded
  data row. New cache rows just get a different `params_hash` (which already includes
  `engine`).
- **HED stays frozen.** Its public surface (`SweepConfig` field names, `per_d2`, `.d2`)
  and its 35-test oracle are preserved. The generalization is additive; HED delegates to
  the shared core only once an equivalence test proves the drift-only path is unchanged.

## The unifying abstraction: the **candidate**

Today the sweep's only free variable is `D2`. We generalize that single key into a
**candidate** = one fully-specified barrier geometry, tagged by *scale*:

```
candidate = (scale, entry_coef, target_coef, time_barrier)

drift  (= HED):  entry = price ± speed·d1      target = speed·time_barrier
                 → entry_coef≡d1 (fixed), target_coef≡time_barrier (coupled); sweep time_barrier
range:           entry = price ± entry_coef·dispersion    target = target_coef·dispersion
                 → entry_coef fixed (the D1 analogue); sweep (target_coef × time_barrier)
```

- **`entry_coef` is a fixed config constant per scale** — the direct analogue of HED's
  `d1` (which is *not* swept; confirmed in `run_sweep`). For range it is *not* a search
  dimension.
- **Swept range dimensions are only `target_coef` × `time_barrier`** — a 2-D grid. The
  `target_coef` is the dispersion fraction (the 0.5/0.8 knob the user hand-corrects in the
  sheet); history calibrates it instead of a human guessing.
- **`time_barrier` is decoupled from the target in the range scale** (dispersion already
  sized the target), so it is a free dimension; in drift it stays coupled (= HED).

HED's candidate set = `{(drift, d1, h, h) : h ∈ d2_range}` → byte-identical geometry to
today. Dispersion-and-Momentum's set = HED's drift candidates **plus** the range grid.

## Scale, speed, dispersion

- **Speed = blended fast/slow drift.** `speed = Σ wᵢ · avgChangePctᵢ` over configured
  `(period, weight)` windows. HED = `[[50, 1.0]]`; new strategy = `[[50, 0.2], [5, 0.8]]`
  (20% on the 50-day, 80% on the 5-day). Same point-in-time, no-lookahead operator.
- **Dispersion = normalized 30-day range:** `(max(high,30) − min(low,30)) / price`, a %
  so `target_coef · dispersion` is a fractional move. Point-in-time (trailing window only).

## Regime selection is emergent, not a rule

The "speed block vs dispersion block" switch and the Excel "+10% in ≤15 days" heuristic
**disappear**. Both scales' candidates flow through the same sweep; `recommend` picks
regular/conservative/aggressive across *all* candidates by the existing CI-lower-bound
objectives (capital-efficiency / win-rate / shortest horizon). The winning candidate's
`scale` is surfaced in the draft (`reason` + per-preset `scale` field) for legibility —
"drift-scaled targets won the efficiency comparison" rather than a magic threshold.

## Fill-rate is per-scale

With a fixed `entry_coef` per scale, every candidate within a scale shares **one** entry
price → one fill per entry date (exactly as HED shares one fill across all D2). So
fill-rate is computed **per scale** (drift's entry vs range's entry — two values), and
efficiency uses the candidate's own scale fill-rate. This is the only semantic change vs
HED's single sweep-level fill-rate.

## Low-confidence fallback

True chop sits near the `1/(1+PLR)` break-even floor, so the sweep will *honestly* return
low-confidence often in ranging regimes — correct, not a bug. When that happens the new
strategy still drafts a deterministic actionable preset: `entry_coef·dispersion` entry,
`target_coef = 0.5·dispersion` TP (the Excel "safe" fraction), SL from PLR — flagged
low-confidence. The guessed fraction is demoted from "the answer" to "the safety net".

## v1 scope

- **Structural params seed-hardcoded** in the strategy row: `scales`, `speed_windows`,
  the range grids (`target_coef` set, `time_barrier` set), `entry_coef`. These don't fit
  the current `ParamField` widget types (`number|int|int_range|select`).
- **Admin UI exposes only scalar knobs** that render with existing widgets: PLR, lookback,
  dispersion window, gate thresholds. Promoting structural params to editable widgets
  (multi-select scales, weight-pair speed windows) is deferred.

## Implementation sequence (each step keeps HED's 35 tests green)

1. **Primitives (additive):** `speed.blended_speed(closes, end_idx, windows)`,
   `speed.dispersion_pct(highs, lows, end_idx, window)`. + unit tests.
2. **Generalized core (additive):** candidate model + `run_candidate_sweep` +
   candidate-generic `recommend` (reusing `barriers` and the stationary-bootstrap helper).
   New unit tests.
3. **Equivalence lock:** drift-only candidates reproduce HED's `per_d2` stats on shared
   fixtures — the regression oracle that authorizes delegation.
4. **HED delegates** to the core behind its existing `SweepConfig`/`per_d2`/`.d2` adapter;
   full suite must stay green. (Fallback if exact bootstrap reproduction proves fiddly:
   share primitives only, keep HED's driver — identical product, slightly less DRY.)
5. **Engine + wiring:** `DISPERSION_MOMENTUM` schema; `draft_service._resolve` reads new
   keys with HED-compatible fallbacks (`scales`→`["drift"]`, `speed_period`→
   `speed_windows=[[p,1.0]]`); generalize `draft_prices`; extend draft payload/schema with
   optional `scale`/coef fields (HED payload unchanged).
6. **Seed** the "Dispersion and Momentum" row.
7. **Tests:** new-engine sweep (range wins in chop, drift in trend), draft end-to-end,
   engine-list.
8. **Frontend:** render optional `scale`/coef on preset cards for explanation; admin shows
   scalar knobs only.

---

# Addendum: sweep the speed blend (the momentum-persistence axis)

**Status: built (2026-06-21).** Turns the last guessed constant — the fast/slow blend
weight — into a swept dimension, the same move already applied to the dispersion fraction
and the holding horizon.

## Motivation

Running HED vs DM-drift on the same ticker is, in effect, asking *"does smoothed trend or
recent momentum better predict this stock's forward move?"* — HED uses a single 50-day
speed; DM uses an 80%-fast blend. At fixed PLR the win-rate is ~scale-invariant under a
random walk, so the edge above break-even reflects **how well the speed estimator predicts
forward drift**. A fast-weighted blend chases short-term momentum that often mean-reverts,
so its targets get hit less — observed as uniformly lower drift win-rates on a name whose
momentum doesn't persist. That makes the blend weight a *predictor-quality* knob, not a
cosmetic one — exactly the kind of thing history should choose per ticker.

## Design

A drift candidate becomes **(speed-blend variant × horizon)** instead of just a horizon.
Periods stay fixed at **50 / 5**; only the **slow-window weight** is swept over a small
discrete set:

| Variant | `speed_windows`        | Meaning                    |
|---------|------------------------|----------------------------|
| smooth  | `[[50, 1.0]]`          | pure trend (= HED)         |
| balanced| `[[50, 0.5], [5, 0.5]]`| half-and-half              |
| reactive| `[[50, 0.2], [5, 0.8]]`| current DM default         |

Seed set = **{1.0, 0.5, 0.2}** (brackets HED ↔ current DM). 3 variants × 60 horizons = 180
drift + 24 range = **204 candidates**. `recommend` already picks across all candidates by
CI-lower-bound, so *which persistence assumption paid off* becomes an output — the manual
HED-vs-DM comparison becomes automatic candidate selection.

**Weight-only for v1** (periods fixed). Varying periods is a clean follow-on axis, deferred
to limit candidate count and multiple-comparison risk.

## The one real mechanic: entry geometry

Today every drift candidate shares one speed per entry date → one fill per scale. Different
blends produce **different speeds → different entries (`price ± speed·d1`) → different
fills.** So the sweep's fill loop generalizes from "one entry per **scale**" to "one entry
per **entry geometry**", where a geometry = a blend variant (drift) or the dispersion entry
(range). **Fill-rate becomes per-geometry**; `recommend` already consumes per-candidate
fill-rate, so it is unaffected. A candidate carries its blend (`speed_windows` + a
`blend_label`); geometry grouping keys on it.

Config keeps `speed_windows` as the single-blend default and adds
`drift_speed_blends: tuple[blend, ...] | None`; effective blends =
`drift_speed_blends or (speed_windows,)`. **HED's config (one blend) is unchanged → one
geometry → bit-identical**, guarded by `test_candidate_sweep::test_drift_only_matches_hed`.

## Surfacing & guardrails

- Each drift candidate carries a `blend_label` ("smooth 50d", "50/5 @ 20% slow") → payload,
  a **Blend column** in the compare table, and the preset card ("Basis: momentum (smooth 50d)").
- Live `draft_prices` uses **the winning candidate's own blend** to size entry/TP.
- **Keep the variant set small (3).** Adding an axis multiplies candidates and raises
  winner's-curse risk; variants are highly correlated (same horizons), so a big set buys
  little independent information. CI-lower-bound + plateau selection already resists this.
- `payload_version` bumped (payload shape changes → cache invalidation).

## Steps (each keeps HED's tests green)

1. Candidate + config carry the blend; `effective_blends`; `build_candidates` does
   `blends × horizons`; `min_warmup` over all blends' periods.
2. Refactor the fill loop to **per-entry-geometry**; per-geometry fill-rate; keep per-scale
   aggregates for HED. **Re-run the HED equivalence — must stay bit-identical.**
3. Live draft + payload + schema carry `blend_label`; `draft_prices` uses the candidate's blend.
4. Seed `drift_speed_blends = [[[50,1.0]], [[50,0.5],[5,0.5]], [[50,0.2],[5,0.8]]]`; engine schema.
5. Tests: variants distinct; the `1.0` variant matches HED; winning blend surfaced.
6. Frontend: Blend column in the compare table + on the preset card.
