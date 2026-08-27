# ORCA Static Dashboard

This directory is the GitHub Pages application for the ORCA-Lite cross-asset regime dashboard.

- `index.html` — semantic page structure
- `styles.css` — approved warm editorial design system
- `app.js` — rendering, interactions, charts, heatmap, network, and explanations
- `data/dashboard.json` — derived bundle produced by `scripts/orca_build.py`

The browser never receives the EODHD API token. All data acquisition and calculations occur in GitHub Actions.
