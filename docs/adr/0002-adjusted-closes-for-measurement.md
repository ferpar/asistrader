# Adjusted closes for measurement, raw closes for execution

Market data stores raw, unadjusted closes so SL/TP detection matches the prices the trader actually saw. Long-window measures (Basket Indexes, the Momentum Score) break on raw closes: a split looks like a crash and dividends look like losses. We store an adjusted close alongside the raw one and use it only for measurement; SL/TP detection and Portfolio Value keep using raw closes, since they deal in real prices and real units.
