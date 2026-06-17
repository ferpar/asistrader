"""The engine catalog: the fixed, code-defined set of automated-strategy engines.

An *engine* is executable logic (the sweep) plus a declared parameter schema with
defaults. A *strategy* is a DB row that binds to an engine (`params.engine`) and
supplies param values. The admin UI renders a typed form from an engine's schema,
so automated strategies are created as ordinary data — never seeded via migration.

Currently one engine: `historical_expected_days`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class ParamField:
    """One configurable parameter, enough for the UI to render a typed input."""

    key: str
    label: str
    type: str  # "number" | "int" | "int_range" | "select"
    default: Any
    options: list[str] | None = None  # for type == "select"
    min: float | None = None
    max: float | None = None
    step: float | None = None
    help: str | None = None


@dataclass(frozen=True)
class Engine:
    id: str
    label: str
    description: str
    fields: list[ParamField] = field(default_factory=list)

    def default_params(self) -> dict[str, Any]:
        """The default `params` blob for a new strategy bound to this engine."""
        out: dict[str, Any] = {"engine": self.id}
        for f in self.fields:
            out[f.key] = f.default
        return out


HISTORICAL_EXPECTED_DAYS = Engine(
    id="historical_expected_days",
    label="Historical Expected Days",
    description=(
        "Replays history as a triple-barrier sweep over (entry date x holding "
        "horizon) to recommend a holding/target horizon, with regular/aggressive/"
        "conservative presets."
    ),
    fields=[
        ParamField("plr_default", "Profit-loss ratio (PLR)", "number", 1.5,
                   min=0.1, step=0.1, help="Reward:risk. Default 1.5; overridable per draft."),
        ParamField("d1_default", "Days to fill (D1)", "int", 1, min=0,
                   help="Expected bars for the order to fill."),
        ParamField("d2_range", "Holding horizon range (D2, days)", "int_range", [1, 60],
                   help="The horizons the sweep searches."),
        ParamField("lookback_years", "Lookback (years)", "int", 3, min=1, max=15,
                   help="Recency-weighted history window."),
        ParamField("speed_period", "Speed window (bars)", "int", 50, min=2,
                   help="Trailing window for the avg daily % change (drift)."),
        ParamField("order_type_default", "Default order type", "select", "limit",
                   options=["limit", "stop", "market"]),
        ParamField("time_in_effect_default", "Default time-in-effect", "select", "gtd",
                   options=["day", "gtc", "gtd"]),
        ParamField("side_default", "Default side", "select", "long",
                   options=["long", "short"]),
        ParamField("min_margin_over_breakeven", "Min margin over break-even", "number", 0.05,
                   min=0, max=1, step=0.01, help="Win-rate CI must clear 1/(1+PLR) by this."),
        ParamField("min_effective_samples", "Min effective samples", "int", 30, min=1,
                   help="Below this a preset is flagged low-confidence."),
    ],
)


ENGINES: dict[str, Engine] = {HISTORICAL_EXPECTED_DAYS.id: HISTORICAL_EXPECTED_DAYS}


def list_engines() -> list[Engine]:
    return list(ENGINES.values())


def get_engine(engine_id: str | None) -> Engine | None:
    if engine_id is None:
        return None
    return ENGINES.get(engine_id)
