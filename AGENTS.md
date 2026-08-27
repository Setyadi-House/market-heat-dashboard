# AGENTS.md — ORCA Dashboard

## Mission
Maintain a reliable, point-in-time, cross-asset regime and diversification dashboard with minimal user intervention.

## Repository boundaries
- The existing Market Heat dashboard at the repository root must remain operational.
- ORCA static files live under `orca/`.
- The data pipeline lives in `scripts/orca_build.py`.
- The production bundle is `orca/data/dashboard.json`.

## Non-negotiable rules
1. Never commit, print, log, or expose `EODHD_API_TOKEN`.
2. Never place an API token in browser JavaScript or HTML.
3. Do not silently forward-fill market data. Document every alignment decision.
4. Do not backfill XLRE before its actual history. If a proxy is ever introduced, it must be explicit, versioned, and separately validated.
5. Do not describe rolling percentile ranks as literal event probabilities.
6. Keep Live View free of future outcome information. Forward returns belong only in Research View.
7. Do not claim exact replication of arXiv:2604.17251 until the paper's feature-count, timing, and XLRE ambiguities are resolved and independently reproduced.
8. Preserve audit metadata, latest market date, data mode, model version, and warning banners.
9. Complete implementation and run all acceptance checks before requesting user review.

## Standard commands
```bash
pip install -r requirements-orca.txt
python -m unittest discover -s tests -v
python scripts/orca_build.py --mode demo --output /tmp/orca-dashboard.json
node --check orca/app.js
```

## Acceptance gates
- 24 assets exactly.
- Four valid 24×24 matrices: Composite, EWM 30D half-life, Rolling 60D, Rolling 120D.
- Symmetric matrices, unit diagonal, correlations within [-1, 1].
- At least 1,000 historical observations in the published bundle.
- No `NaN`, `Infinity`, credentials, or raw secret values in JSON.
- Existing root dashboard files must not be removed or broken.
- CI must pass before merge.

## Change philosophy
Prefer transparent calculations and explicit caveats over opaque complexity. New machine-learning layers must be additive, independently validated, calibrated, and benchmarked against the transparent ORCA-Lite baseline.
