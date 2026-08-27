# Market Heat Dashboard

This public dashboard presents the Market Heat & Fragility Score, including
current market-heat context, historical readings, component indicators, and
data freshness. It is a sanitized, derived public output from a private
analytical workflow.

## Dashboards

- Market Heat & Fragility Score: repository root / GitHub Pages root.
- ORCA Regime Correlation Dashboard: `/orca/` on GitHub Pages.

The ORCA subproject monitors the changing correlation structure of the paper's
24-ETF universe. It publishes a deterministic demo bundle before the first live
EODHD run, then updates automatically from the `EODHD_API_TOKEN` GitHub Actions
secret. ORCA is a risk-context and portfolio-diagnostics tool, not a standalone
or deterministic forecast.

## Interpretation

- The raw monthly Heat Score remains the official score.
- The 12-month moving average (MA12) is presentation-only.
- The current month is provisional.
- The last completed month is the decision anchor.
- Source data may contain publication lags.
- This dashboard provides risk context and is not a standalone trading signal.
