# ORCA Implementation Audit

## Engineering checks
- [x] Exact 24-ETF universe.
- [x] EWM 30-day-half-life matrix.
- [x] Rolling 60D matrix.
- [x] Rolling 120D matrix.
- [x] Composite diagnostic view.
- [x] Matrix symmetry, unit diagonal, and range validation.
- [x] No forward filling.
- [x] No XLRE pre-inception backfill.
- [x] Credential kept in GitHub Actions secret storage.
- [x] Deterministic demo mode for CI.
- [x] Unit tests and JSON validation.
- [x] Front-end JavaScript syntax validation.
- [x] Live and Research views separated.
- [x] Percentile-rank warning displayed.

## Research limitations
- The live scoring layer is a transparent ORCA-Lite approximation, not the paper's exact unpublished implementation.
- The paper's stated feature split is internally inconsistent.
- The paper's classification-fold duration and strategy backtest duration are not fully reconciled.
- Exact false-alarm rates, calibration, independent crisis episodes, and hedge P&L require a subsequent live shadow-validation phase.

## Post-launch monitoring
Track daily:
- data freshness and missing rows;
- estimator agreement;
- signal changes and threshold crossings;
- false alarms per year;
- median warning lead time;
- 5D, 10D, and 20D outcomes after regime changes;
- option-hedge cost once ORATS is integrated.
