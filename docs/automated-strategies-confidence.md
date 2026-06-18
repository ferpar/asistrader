# Automated Strategies — Raising Statistical Confidence (v2 notes)

## Why this doc

The v1 "historical-expected-days" engine is deliberately **assumption-light**: it
replays the one realized price path and runs a triple-barrier sweep. That makes it
honest, but **low-powered** on a single ticker with limited history — it often
returns *low confidence* because the edge can't be statistically distinguished from
the break-even noise floor. This doc captures the analysis of *why*, and the
avenues for raising confidence in a recommendation, ranked by how much **real**
information they add vs. how much they trade for **model risk**. These are v2
directions, not built yet. See [`automated-strategies.md`](./automated-strategies.md)
for the v1 design.

## The core constraint

Confidence comes from **independent information**. You can only get more of it by:
1. **using the data you have more efficiently**,
2. **bringing in more data**, or
3. **bringing in a model / assumption** (confidence then becomes *conditional* on it).

Randomness on its own — "just Monte-Carlo it" — adds nothing unless it does one of
the above. Anything that claims to tighten the estimate without new data, more
efficient use, or an assumption is relabeling uncertainty, not removing it.

## Why v1 is low-powered (the effective-sample-size problem)

At a fixed PLR the break-even win-rate is `1/(1+PLR)` (40% at 1.5). To call a
strategy an edge, its win-rate CI must clear that floor by a margin. The CI width
is driven by the number of **independent** observations, which is much smaller than
the trial count:

- **Overlapping windows.** A trade entered Monday and one entered Tuesday at a
  33-day horizon share 32 of 33 days — nearly the same outcome. The number of
  *non-overlapping* windows ≈ `span / D2`. Worked example: ~489 trials at D2=33 →
  **~15 effectively independent** windows.
- **The empirical estimator throws away information.** Each window is collapsed to
  a single win/loss bit; ~15 bits → `std ≈ sqrt(p(1-p)/15) ≈ ±13%`, i.e. a win-rate
  CI like 31–55% around a 43% point estimate. That straddles 40% → low confidence.
- **Recency weighting doesn't rescue it.** It helps *relevance* (matching the
  current regime), not *confidence*. Unequal weights **reduce** the effective sample
  size (Kish: `n_eff = (Σw)² / Σw²` < n), so leaning on recent data leans on
  *fewer* observations, not more. Bias axis, not variance axis.
- **Shorter horizons are better-powered.** `span / D2` grows as D2 shrinks, so the
  *aggressive* preset's CI is generally tighter than regular/conservative on the
  same ticker — sometimes the short horizon clears the bar when the longer ones
  can't.

## Avenues to raise confidence (ranked, most-honest first)

### 1. Cross-sectional pooling — the biggest *real* lever
Estimate the **strategy's** edge across *many tickers*, not one in isolation.
Different tickers' paths are far less correlated than overlapping windows on one
name, so hundreds of tickers yield thousands of weakly-correlated observations —
genuinely more independent information. Optionally **hierarchical**: shrink each
ticker's estimate toward the cohort/sector/universe mean.
- **Cost:** a different *estimand* — "does this strategy work in general" rather
  than "on this specific ticker." Usually the more trustworthy question anyway,
  since most per-ticker edges are noise.
- **Fit:** the radar/screening layer already loads a universe of tickers + history.

### 2. Volatility-normalized barriers — cleaner, exchangeable samples
Size TP/SL in **volatility units** (`k·σ·√D2`, or ATR-based) instead of `speed×D2`.
Then a trial in a calm regime and one in a wild regime measure the *same* event
("reach k sigmas"), so they're exchangeable and the pooled estimate isn't polluted
by regime shifts. A gain in sample **quality**, not count.

### 3. Return-model Monte Carlo — efficiency, at the cost of model risk
Fit the daily-return process (drift + vol, or **block-bootstrap the empirical daily
returns**) and simulate many synthetic forward paths, running the barrier on each.
- **Why it genuinely helps:** it uses all ~500 *daily* returns to estimate
  drift/vol, rather than collapsing history into ~15 window bits — far more
  efficient → tighter CI, *still legitimate* **if** the iid/stationarity assumption
  roughly holds.
- **The trap:** plugging in point estimates of μ, σ gives **falsely tight** CIs. To
  stay honest, **propagate parameter uncertainty** — sample μ, σ from their own
  sampling distribution (or block-bootstrap returns so vol-clustering and fat tails
  survive). Done honestly, the CI widens back toward the assumption-light one; the
  net gain is the efficiency of using daily returns, bounded by model fidelity.

### 4. Vol/drift first-passage prior + Bayesian shrinkage
With μ and σ, the barrier-hit probability has a closed form (the first-passage /
two-barrier problem; the driftless case is the `b/(a+b)`=40% baseline, with drift a
known formula). Use it as a **prior** and blend with the thin empirical estimate via
shrinkage. A vol-derived prior is far more stable than a 15-sample empirical
win-rate, so the posterior is tighter and better-calibrated — conditional on the
prior being reasonable.

### What does *not* help
- **Bucketing/conditioning by vol regime** — splits the ~15 samples into even fewer
  per bucket. Reduces confidence.
- **Recency weighting** — relevance, not confidence; lowers effective N (see above).

## Summary

| Technique | What it adds | Cost / assumption | Confidence effect |
|-----------|--------------|-------------------|-------------------|
| Cross-sectional pooling | Genuinely new independent data | Estimates *strategy* edge, not ticker idiosyncrasy | **Large, real** |
| Vol-normalized barriers | Sample homogeneity (exchangeability) | Barriers defined in σ-units | Moderate, real |
| Return-model Monte Carlo | Efficient use of daily returns | iid/stationarity; must propagate μ,σ uncertainty | Real *if* model holds; else overconfident |
| Vol/drift first-passage prior | Stable model-based prior | Process model reasonable | Tighter, calibrated (conditional) |
| Vol-regime bucketing | — | — | **Worse** (splits samples) |
| Recency weighting | Relevance to current regime | — | Neutral→worse on variance |

**Bottom line:** the only unconditional confidence gain is *more independent data* —
in practice, **pooling across the ticker universe**. Everything else either improves
sample quality (vol-normalization), uses the existing data more efficiently at the
price of a model assumption (MC, first-passage prior), or doesn't help. v1 stays
assumption-light and simply reports low confidence when the single-ticker evidence
is thin — which is the honest outcome.
