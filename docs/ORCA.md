# ORCA Dashboard — Operations and Methodology

## Live URL
After the files are merged into the GitHub Pages source branch, ORCA is served at:

`https://setyadi-house.github.io/market-heat-dashboard/orca/`

## Automation
The workflow `.github/workflows/orca-daily.yml` runs at 23:30 UTC on weekdays, approximately 06:30 Asia/Jakarta the following morning. It:

1. downloads adjusted daily closes for the exact 24-ETF universe from EODHD;
2. aligns dates using an inner join with no forward fill;
3. calculates EWM, rolling-60D, and rolling-120D correlation matrices;
4. calculates spectral, network, price, drawdown, breadth, and volatility indicators;
5. creates transparent ORCA-Lite rally and crash scores and 126-day percentile ranks;
6. validates the bundle; and
7. commits only `orca/data/dashboard.json` when the output changes.

The only secret is `EODHD_API_TOKEN`, stored in GitHub Actions repository secrets.

## Model status
This is a transparent ORCA-Lite implementation inspired by arXiv:2604.17251v1. It is not represented as an exact replication of the authors' Random Forest because the paper contains unresolved inconsistencies involving feature counts, out-of-sample timing, and XLRE history.

## Regime rules
- Crash rank ≥ 60: Crisis, illustrative equity risk band 0.0×.
- Rally rank ≥ 90 and crash rank < 60: Euphoria, illustrative risk band 0.0×.
- Crash rank 40–60: Caution, illustrative risk band 0.7×.
- Rally rank 78–90 and crash rank < 40: Rally, illustrative risk band 1.5×.
- Otherwise: Normal, illustrative risk band 1.0×.

Percentile ranks compare the current transparent score with the trailing 126 trading days. They are not literal probabilities.

## Data policy
- EODHD endpoint: `/api/eod/{ticker}.US` with `fmt=json` and adjusted close.
- No browser-side API calls.
- No forward fill.
- No pre-inception XLRE backfill.
- The common panel begins at the first date when all 24 ETFs have actual data.
- A live build fails if the common panel is too short or more than seven calendar days stale.

## Manual run
The workflow can be run from GitHub Actions using **Build ORCA dashboard → Run workflow**. Routine operation is scheduled and does not require manual intervention.
