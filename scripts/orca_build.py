#!/usr/bin/env python3
"""Build the ORCA-Lite dashboard data bundle.

This is a transparent production approximation inspired by
"ORCA — Online Regime Correlation Analyzer" (arXiv:2604.17251v1).
It intentionally does not claim exact paper replication because the paper has
unresolved feature-count, validation-timeline, and XLRE-history ambiguities.

Live mode downloads adjusted daily closes from EODHD using the environment
variable EODHD_API_TOKEN. The token is never written to disk or logged.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import pandas as pd
import requests

SCHEMA_VERSION = "1.0.0"
MODEL_VERSION = "orca-lite-1.0.0"
DEFAULT_FROM = "2015-01-01"
EODHD_URL = "https://eodhd.com/api/eod/{symbol}.US"

ASSETS: list[dict[str, Any]] = [
    {"ticker": "SPY", "name": "SPDR S&P 500 ETF", "group": "Broad US equity", "role": "US large-cap equity beta"},
    {"ticker": "QQQ", "name": "Invesco QQQ Trust", "group": "Broad US equity", "role": "Nasdaq-100 growth and technology beta"},
    {"ticker": "IWM", "name": "iShares Russell 2000 ETF", "group": "Broad US equity", "role": "US small-cap and domestic-cycle beta"},
    {"ticker": "XLF", "name": "Financial Select Sector SPDR Fund", "group": "US sectors / REIT", "role": "Banks, insurers, and capital markets"},
    {"ticker": "XLE", "name": "Energy Select Sector SPDR Fund", "group": "US sectors / REIT", "role": "Oil and gas equities"},
    {"ticker": "XLK", "name": "Technology Select Sector SPDR Fund", "group": "US sectors / REIT", "role": "US technology sector"},
    {"ticker": "XLV", "name": "Health Care Select Sector SPDR Fund", "group": "US sectors / REIT", "role": "Defensive growth and health care"},
    {"ticker": "XLU", "name": "Utilities Select Sector SPDR Fund", "group": "US sectors / REIT", "role": "Rate-sensitive defensive equities"},
    {"ticker": "XLP", "name": "Consumer Staples Select Sector SPDR Fund", "group": "US sectors / REIT", "role": "Defensive consumption"},
    {"ticker": "XLY", "name": "Consumer Discretionary Select Sector SPDR Fund", "group": "US sectors / REIT", "role": "Cyclical consumption"},
    {"ticker": "XLI", "name": "Industrial Select Sector SPDR Fund", "group": "US sectors / REIT", "role": "Industrial cycle"},
    {"ticker": "XLB", "name": "Materials Select Sector SPDR Fund", "group": "US sectors / REIT", "role": "Materials and global cycle"},
    {"ticker": "XLRE", "name": "Real Estate Select Sector SPDR Fund", "group": "US sectors / REIT", "role": "Listed real estate and rate sensitivity"},
    {"ticker": "EFA", "name": "iShares MSCI EAFE ETF", "group": "International equity", "role": "Developed markets outside the US"},
    {"ticker": "EEM", "name": "iShares MSCI Emerging Markets ETF", "group": "International equity", "role": "Emerging-market equities"},
    {"ticker": "VGK", "name": "Vanguard FTSE Europe ETF", "group": "International equity", "role": "European equities"},
    {"ticker": "EWJ", "name": "iShares MSCI Japan ETF", "group": "International equity", "role": "Japanese equities"},
    {"ticker": "TLT", "name": "iShares 20+ Year Treasury Bond ETF", "group": "Fixed income / credit", "role": "Long-duration US Treasuries"},
    {"ticker": "IEF", "name": "iShares 7-10 Year Treasury Bond ETF", "group": "Fixed income / credit", "role": "Intermediate US Treasuries"},
    {"ticker": "LQD", "name": "iShares iBoxx Investment Grade Corporate Bond ETF", "group": "Fixed income / credit", "role": "Investment-grade corporate credit"},
    {"ticker": "HYG", "name": "iShares iBoxx High Yield Corporate Bond ETF", "group": "Fixed income / credit", "role": "High-yield credit and risk appetite"},
    {"ticker": "GLD", "name": "SPDR Gold Shares", "group": "Commodities", "role": "Gold and defensive real asset"},
    {"ticker": "USO", "name": "United States Oil Fund", "group": "Commodities", "role": "WTI crude-oil futures proxy"},
    {"ticker": "UUP", "name": "Invesco DB US Dollar Index Bullish Fund", "group": "Currency", "role": "Long US-dollar basket"},
]
TICKERS = [item["ticker"] for item in ASSETS]

EXPLANATIONS: dict[str, dict[str, str]] = {
    "ar1": {
        "title": "One-factor absorption ratio (AR1)",
        "measure": "The share of total cross-asset movement explained by the single largest common factor.",
        "simple": "If AR1 is 40%, one broad force—such as liquidity, rates, inflation, or fear—explains about 40% of the movement across all 24 assets.",
        "portfolio": "A high or rapidly rising value means diversification is becoming more dependent on one macro driver.",
    },
    "ar3": {
        "title": "Top-three absorption ratio (AR3)",
        "measure": "The share of total movement explained by the three largest common factors.",
        "simple": "If AR3 is 65%, most of the market is responding to only three broad forces.",
        "portfolio": "A high value means many apparently different positions may still be concentrated in a few macro bets.",
    },
    "effective_rank": {
        "title": "Effective rank / effective bets",
        "measure": "An estimate of how many statistically independent sources of risk remain in the 24-asset universe.",
        "simple": "A reading of 8 means 24 tickers currently behave more like eight genuinely different bets.",
        "portfolio": "A falling value warns that the number of holdings may overstate actual diversification.",
    },
    "spectral_gap": {
        "title": "Dominant-factor ratio (spectral gap)",
        "measure": "How large the first eigenvalue is compared with the second eigenvalue.",
        "simple": "A reading of 3x means the strongest common factor is about three times as powerful as the next factor.",
        "portfolio": "A high value suggests one theme is dominating the whole market.",
    },
    "edge_density_05": {
        "title": "Strong-connection share (edge density)",
        "measure": "The fraction of all 276 unique asset pairs with absolute correlation above 0.50.",
        "simple": "A reading of 46% means roughly 127 of 276 pairs have a strong relationship.",
        "portfolio": "A high or rising value means shocks can spread across more of the portfolio.",
    },
    "clustering": {
        "title": "Clustering coefficient",
        "measure": "How often strongly linked assets form tightly connected groups or triangles.",
        "simple": "If SPY links to QQQ and XLK, and QQQ also links to XLK, they form a tight cluster.",
        "portfolio": "Dense clusters can reveal duplicate exposures that look diversified only because they use different tickers.",
    },
    "condition_number": {
        "title": "Matrix instability (condition number)",
        "measure": "The ratio between the strongest and weakest risk directions in the correlation matrix.",
        "simple": "A high value is like a table whose weight is concentrated on one leg: small data changes can create large model changes.",
        "portfolio": "High instability reduces confidence in optimized weights and fine-tuned allocation outputs.",
    },
    "mp_excess": {
        "title": "Common factor above random noise",
        "measure": "How far the largest eigenvalue sits above the Marchenko-Pastur random-noise boundary.",
        "simple": "A positive excess suggests the common factor is too large to be explained by random correlations alone.",
        "portfolio": "A large excess strengthens the case that the observed herding is economically meaningful.",
    },
    "realized_vol_20d": {
        "title": "20-day realised volatility",
        "measure": "The annualised variability of daily SPY returns over the last 20 trading days.",
        "simple": "Higher realised volatility means the market is making larger daily moves than usual.",
        "portfolio": "It can confirm stress, but it often reacts after fragility has already increased.",
    },
    "drawdown_60d": {
        "title": "60-day drawdown",
        "measure": "How far SPY is below its highest close in the last 60 trading days.",
        "simple": "A -10% reading means SPY is 10% below its two-to-three-month high.",
        "portfolio": "A deep drawdown can create rebound potential while also indicating an unstable market.",
    },
    "drawdown_20d": {
        "title": "20-day drawdown",
        "measure": "How far SPY is below its highest close in the last 20 trading days.",
        "simple": "It measures shorter-horizon damage and oversold conditions.",
        "portfolio": "A deep reading can raise mean-reversion potential, but should be read with crash risk.",
    },
    "price_vs_sma50": {
        "title": "Price versus 50-day moving average",
        "measure": "The percentage distance between SPY and its 50-day average price.",
        "simple": "A -5% reading means SPY trades 5% below its medium-term trend.",
        "portfolio": "Below-trend prices can confirm weakness or create rebound potential depending on the wider regime.",
    },
    "return_5d": {
        "title": "Five-day return / short-term reversal",
        "measure": "SPY's total return over the last five trading days.",
        "simple": "A positive rebound after a drawdown may strengthen a rally setup.",
        "portfolio": "The signal is more credible when breadth and credit also improve.",
    },
    "breadth_20d": {
        "title": "Cross-asset breadth",
        "measure": "The share of the 24 assets trading above their own 20-day moving averages.",
        "simple": "A 25% reading means only six of 24 assets are above their short-term trends.",
        "portfolio": "Narrow breadth makes a headline-index rally less trustworthy.",
    },
}


@dataclass(frozen=True)
class EstimatorResult:
    matrix: np.ndarray
    metrics: dict[str, float]
    sample_size: int


def _safe_float(value: Any, digits: int = 6) -> float | None:
    if value is None or pd.isna(value) or not np.isfinite(value):
        return None
    return round(float(value), digits)


def fetch_eodhd_series(ticker: str, token: str, start: str) -> pd.Series:
    """Fetch one adjusted-close series without exposing the API token."""
    params = {
        "api_token": token,
        "fmt": "json",
        "period": "d",
        "order": "a",
        "from": start,
    }
    headers = {"User-Agent": "ORCA-Dashboard/1.0"}
    last_error = "unknown error"
    for attempt in range(1, 4):
        try:
            response = requests.get(
                EODHD_URL.format(symbol=ticker),
                params=params,
                headers=headers,
                timeout=45,
            )
            if response.status_code != 200:
                last_error = f"HTTP {response.status_code}"
            else:
                payload = response.json()
                if not isinstance(payload, list) or not payload:
                    last_error = "empty or invalid JSON response"
                else:
                    frame = pd.DataFrame(payload)
                    if "date" not in frame or "adjusted_close" not in frame:
                        last_error = "required fields missing"
                    else:
                        series = pd.Series(
                            pd.to_numeric(frame["adjusted_close"], errors="coerce").to_numpy(),
                            index=pd.to_datetime(frame["date"], errors="coerce"),
                            name=ticker,
                        ).dropna()
                        series = series[~series.index.duplicated(keep="last")].sort_index()
                        if len(series) < 300:
                            last_error = f"only {len(series)} valid observations"
                        else:
                            return series
        except (requests.RequestException, ValueError) as exc:
            last_error = exc.__class__.__name__
        if attempt < 3:
            time.sleep(attempt * 2)
    raise RuntimeError(f"EODHD download failed for {ticker}: {last_error}")


def load_live_prices(token: str, start: str) -> tuple[pd.DataFrame, dict[str, Any]]:
    series: list[pd.Series] = []
    source_rows: dict[str, Any] = {}
    for ticker in TICKERS:
        item = fetch_eodhd_series(ticker, token, start)
        series.append(item)
        source_rows[ticker] = {
            "rows": int(len(item)),
            "first_date": item.index.min().date().isoformat(),
            "last_date": item.index.max().date().isoformat(),
        }
        print(f"Fetched {ticker}: {len(item)} rows through {item.index.max().date()}")

    outer = pd.concat(series, axis=1, join="outer").sort_index()
    common = outer.dropna(how="any")
    if len(common) < 1_500:
        raise RuntimeError(f"Common aligned panel is too short: {len(common)} rows")
    latest = common.index.max().date()
    age_days = (date.today() - latest).days
    if age_days > 7:
        raise RuntimeError(f"Latest common observation is stale: {latest} ({age_days} days old)")

    quality = {
        "source_rows": source_rows,
        "outer_rows": int(len(outer)),
        "common_rows": int(len(common)),
        "common_start": common.index.min().date().isoformat(),
        "common_end": common.index.max().date().isoformat(),
        "latest_age_calendar_days": int(age_days),
        "alignment_policy": "Inner join across all 24 adjusted-close series; no forward filling.",
        "xlre_policy": "No pre-inception backfill. The common sample begins only when all 24 ETFs have actual observations.",
    }
    return common, quality


def generate_demo_prices() -> tuple[pd.DataFrame, dict[str, Any]]:
    """Create deterministic multi-factor prices for CI and initial display."""
    end = pd.Timestamp.utcnow().tz_localize(None).normalize() - pd.offsets.BDay(1)
    index = pd.bdate_range("2015-10-08", end)
    n = len(index)
    rng = np.random.default_rng(260417251)

    # Global risk, duration, inflation, dollar, and energy factors.
    factors = rng.normal(0, [0.0075, 0.0045, 0.0040, 0.0035, 0.0080], size=(n, 5))
    t = np.arange(n)
    for center, width, shock in [
        (int(n * 0.13), 28, -0.030),
        (int(n * 0.42), 22, -0.055),
        (int(n * 0.64), 45, -0.025),
        (int(n * 0.82), 35, -0.035),
    ]:
        pulse = np.exp(-0.5 * ((t - center) / width) ** 2)
        factors[:, 0] += shock * pulse
        factors[:, 1] += (-shock * 0.35) * pulse
        factors[:, 3] += (-shock * 0.22) * pulse

    loadings = {
        "SPY": [.90, .05, .05, -.08, .05], "QQQ": [.94, .22, -.12, -.05, -.08], "IWM": [.88, -.10, .15, -.12, .10],
        "XLF": [.85, -.20, .15, -.08, .03], "XLE": [.58, -.06, .56, -.18, .68], "XLK": [.95, .20, -.10, -.06, -.10],
        "XLV": [.67, .18, -.06, -.03, -.02], "XLU": [.52, .55, -.18, -.02, .02], "XLP": [.59, .28, -.04, .00, -.02],
        "XLY": [.88, .10, .02, -.06, .02], "XLI": [.84, -.02, .26, -.10, .15], "XLB": [.78, -.05, .39, -.15, .22],
        "XLRE": [.61, .58, -.12, -.03, .00], "EFA": [.82, .02, .18, -.32, .10], "EEM": [.79, -.04, .31, -.42, .20],
        "VGK": [.80, .04, .20, -.34, .12], "EWJ": [.68, .18, .02, -.28, .05], "TLT": [-.28, .95, -.48, .08, -.05],
        "IEF": [-.18, .76, -.34, .06, -.03], "LQD": [.28, .62, -.18, .03, .00], "HYG": [.72, .23, .12, -.05, .03],
        "GLD": [-.03, .18, .62, -.52, .06], "USO": [.24, -.05, .72, -.27, .92], "UUP": [-.30, .06, -.25, .94, -.18],
    }
    prices: dict[str, np.ndarray] = {}
    for i, ticker in enumerate(TICKERS):
        beta = np.array(loadings[ticker])
        idio = rng.normal(0, 0.0045 + 0.00025 * (i % 5), n)
        drift = 0.00015 + max(beta[0], 0) * 0.00012
        daily = drift + factors @ beta + idio
        daily = np.clip(daily, -0.16, 0.16)
        start_price = 70 + i * 4
        prices[ticker] = start_price * np.exp(np.cumsum(daily))
    frame = pd.DataFrame(prices, index=index)
    quality = {
        "source_rows": {ticker: {"rows": n, "first_date": index.min().date().isoformat(), "last_date": index.max().date().isoformat()} for ticker in TICKERS},
        "outer_rows": n,
        "common_rows": n,
        "common_start": index.min().date().isoformat(),
        "common_end": index.max().date().isoformat(),
        "latest_age_calendar_days": int((date.today() - index.max().date()).days),
        "alignment_policy": "Deterministic synthetic business-day panel for CI and design validation.",
        "xlre_policy": "Synthetic demo data only. Live mode uses actual XLRE history and no backfill.",
    }
    return frame, quality


def weighted_corr(values: np.ndarray, half_life: float = 30.0) -> np.ndarray:
    if values.ndim != 2 or values.shape[0] < 10:
        raise ValueError("weighted_corr requires a 2D array with at least 10 rows")
    n = values.shape[0]
    ages = np.arange(n - 1, -1, -1, dtype=float)
    weights = np.power(0.5, ages / half_life)
    weights /= weights.sum()
    mean = np.sum(values * weights[:, None], axis=0)
    centered = values - mean
    cov = (centered * weights[:, None]).T @ centered
    correction = 1.0 - float(np.sum(weights**2))
    if correction > 1e-9:
        cov /= correction
    std = np.sqrt(np.clip(np.diag(cov), 1e-14, None))
    corr = cov / np.outer(std, std)
    corr = np.clip((corr + corr.T) / 2.0, -1.0, 1.0)
    np.fill_diagonal(corr, 1.0)
    return corr


def clustering_coefficient(adjacency: np.ndarray) -> float:
    adjacency = adjacency.astype(int).copy()
    np.fill_diagonal(adjacency, 0)
    values: list[float] = []
    for i in range(adjacency.shape[0]):
        neighbors = np.flatnonzero(adjacency[i])
        degree = len(neighbors)
        if degree < 2:
            values.append(0.0)
            continue
        sub = adjacency[np.ix_(neighbors, neighbors)]
        edges = sub.sum() / 2.0
        values.append(float(edges / (degree * (degree - 1) / 2.0)))
    return float(np.mean(values))


def metrics_from_corr(corr: np.ndarray, sample_size: int) -> dict[str, float]:
    corr = np.asarray(corr, dtype=float)
    if corr.shape != (len(TICKERS), len(TICKERS)):
        raise ValueError(f"Unexpected correlation shape: {corr.shape}")
    if not np.allclose(corr, corr.T, atol=1e-8):
        raise ValueError("Correlation matrix is not symmetric")
    eigenvalues = np.linalg.eigvalsh(corr)
    eigenvalues = np.clip(eigenvalues, 1e-9, None)[::-1]
    total = float(eigenvalues.sum())
    shares = eigenvalues / total
    entropy = -float(np.sum(shares * np.log(shares)))
    effective_rank = float(np.exp(entropy))
    off = corr[np.triu_indices_from(corr, k=1)]
    absolute = np.abs(off)
    adjacency_05 = (np.abs(corr) > 0.50).astype(int)
    np.fill_diagonal(adjacency_05, 0)
    dimension = corr.shape[0]
    q = dimension / max(sample_size, dimension + 1)
    mp_upper = (1.0 + math.sqrt(q)) ** 2
    return {
        "ar1": float(shares[0]),
        "ar3": float(shares[:3].sum()),
        "ar5": float(shares[:5].sum()),
        "effective_rank": effective_rank,
        "spectral_gap": float(eigenvalues[0] / max(eigenvalues[1], 1e-9)),
        "condition_number": float(min(eigenvalues[0] / max(eigenvalues[-1], 1e-9), 9999.0)),
        "mp_upper": float(mp_upper),
        "mp_excess": float(max(eigenvalues[0] - mp_upper, 0.0)),
        "lambda1": float(eigenvalues[0]),
        "mean_corr": float(off.mean()),
        "mean_abs_corr": float(absolute.mean()),
        "median_abs_corr": float(np.median(absolute)),
        "edge_density_03": float((absolute > 0.30).mean()),
        "edge_density_05": float((absolute > 0.50).mean()),
        "edge_density_07": float((absolute > 0.70).mean()),
        "clustering": clustering_coefficient(adjacency_05),
        "mean_degree_05": float(adjacency_05.sum(axis=1).mean()),
        "isolated_nodes_05": float((adjacency_05.sum(axis=1) == 0).sum()),
    }


def estimator_results(returns: pd.DataFrame, t: int) -> dict[str, EstimatorResult]:
    if t < 119:
        raise ValueError("At least 120 return observations are required")
    window60 = returns.iloc[t - 59 : t + 1]
    window120 = returns.iloc[t - 119 : t + 1]
    ewm_window = returns.iloc[max(0, t - 251) : t + 1]
    matrices = {
        "60d": window60.corr().to_numpy(),
        "120d": window120.corr().to_numpy(),
        "ewm": weighted_corr(ewm_window.to_numpy(), half_life=30.0),
    }
    results = {
        key: EstimatorResult(matrix=matrix, metrics=metrics_from_corr(matrix, len(window)), sample_size=len(window))
        for key, matrix, window in [
            ("60d", matrices["60d"], window60),
            ("120d", matrices["120d"], window120),
            ("ewm", matrices["ewm"], ewm_window),
        ]
    }
    composite = sum(item.matrix for item in results.values()) / 3.0
    composite = np.clip((composite + composite.T) / 2.0, -1.0, 1.0)
    np.fill_diagonal(composite, 1.0)
    results["composite"] = EstimatorResult(
        matrix=composite,
        metrics=metrics_from_corr(composite, 120),
        sample_size=120,
    )
    return results


def rolling_percentile(series: pd.Series, window: int, min_periods: int) -> pd.Series:
    def percentile(values: np.ndarray) -> float:
        current = values[-1]
        valid = values[np.isfinite(values)]
        if len(valid) == 0 or not np.isfinite(current):
            return np.nan
        less = np.sum(valid < current)
        equal = np.sum(valid == current)
        return float((less + 0.5 * equal) / len(valid) * 100.0)

    return series.rolling(window, min_periods=min_periods).apply(percentile, raw=True)


def _price_features(prices: pd.DataFrame, t_date: pd.Timestamp) -> dict[str, float]:
    loc = prices.index.get_loc(t_date)
    current = prices.iloc[: loc + 1]
    spy = current["SPY"]
    ret = spy.pct_change()
    last = float(spy.iloc[-1])
    sma50 = float(spy.tail(50).mean()) if len(spy) >= 50 else last
    max20 = float(spy.tail(20).max())
    max60 = float(spy.tail(60).max())
    return5 = float(spy.iloc[-1] / spy.iloc[-6] - 1.0) if len(spy) >= 6 else np.nan
    return20 = float(spy.iloc[-1] / spy.iloc[-21] - 1.0) if len(spy) >= 21 else np.nan
    return60 = float(spy.iloc[-1] / spy.iloc[-61] - 1.0) if len(spy) >= 61 else np.nan
    vol20 = float(ret.tail(20).std(ddof=1) * math.sqrt(252)) if len(ret.dropna()) >= 20 else np.nan
    max_loss5 = float(ret.tail(5).min()) if len(ret.dropna()) >= 5 else np.nan
    sma20_all = current.tail(20).mean()
    breadth = float((current.iloc[-1] > sma20_all).mean()) if len(current) >= 20 else np.nan
    trailing20 = current.iloc[-1] / current.iloc[-21] - 1.0 if len(current) >= 21 else pd.Series(np.nan, index=current.columns)
    dispersion = float(trailing20.std(ddof=1)) if trailing20.notna().sum() > 2 else np.nan
    return {
        "return_5d": return5,
        "return_20d": return20,
        "return_60d": return60,
        "realized_vol_20d": vol20,
        "drawdown_20d": float(last / max20 - 1.0),
        "drawdown_60d": float(last / max60 - 1.0),
        "price_vs_sma50": float(last / sma50 - 1.0),
        "max_loss_5d": max_loss5,
        "breadth_20d": breadth,
        "cross_asset_dispersion_20d": dispersion,
    }


def calculate_history(prices: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, EstimatorResult], dict[str, EstimatorResult]]:
    returns = prices.pct_change().dropna()
    rows: list[dict[str, Any]] = []
    latest_results: dict[str, EstimatorResult] | None = None
    prior20_results: dict[str, EstimatorResult] | None = None
    for t in range(119, len(returns)):
        results = estimator_results(returns, t)
        current_date = returns.index[t]
        features = _price_features(prices, current_date)
        row: dict[str, Any] = {"date": current_date}
        for estimator, result in results.items():
            for key, value in result.metrics.items():
                row[f"{estimator}_{key}"] = value
        row.update(features)
        rows.append(row)
        if t == len(returns) - 21:
            prior20_results = results
        if t == len(returns) - 1:
            latest_results = results

    if not rows or latest_results is None:
        raise RuntimeError("Unable to calculate ORCA history")
    history = pd.DataFrame(rows).set_index("date")

    percentile_inputs = {
        "p_ar1": history["composite_ar1"],
        "p_effective_rank": history["composite_effective_rank"],
        "p_density": history["composite_edge_density_05"],
        "p_clustering": history["composite_clustering"],
        "p_vol": history["realized_vol_20d"],
        "p_drawdown60": -history["drawdown_60d"],
        "p_drawdown20": -history["drawdown_20d"],
        "p_trend_oversold": -history["price_vs_sma50"],
        "p_return5": history["return_5d"],
        "p_breadth": history["breadth_20d"],
    }
    for name, values in percentile_inputs.items():
        history[name] = rolling_percentile(values, 252, 126)

    erank_risk = 100.0 - history["p_effective_rank"]
    crash_score = (
        0.20 * history["p_ar1"]
        + 0.20 * erank_risk
        + 0.15 * history["p_density"]
        + 0.10 * history["p_clustering"]
        + 0.15 * history["p_vol"]
        + 0.10 * history["p_drawdown60"]
        + 0.10 * history["p_trend_oversold"]
    )
    history["crash_score"] = crash_score.clip(0, 100)

    vol_opportunity = (100.0 - (history["p_vol"] - 65.0).abs() * 1.6).clip(0, 100)
    breadth_balance = (100.0 - (history["breadth_20d"] * 100.0 - 48.0).abs() * 2.0).clip(0, 100)
    rally_score = (
        0.25 * history["p_drawdown60"]
        + 0.15 * history["p_drawdown20"]
        + 0.20 * history["p_return5"]
        + 0.20 * history["p_trend_oversold"]
        + 0.10 * vol_opportunity
        + 0.10 * breadth_balance
        - 0.20 * (history["crash_score"] - 75.0).clip(lower=0)
    )
    history["rally_score"] = rally_score.clip(0, 100)
    history["crash_rank"] = rolling_percentile(history["crash_score"], 126, 63)
    history["rally_rank"] = rolling_percentile(history["rally_score"], 126, 63)

    def classify(row: pd.Series) -> str:
        crash = row["crash_rank"]
        rally = row["rally_rank"]
        if pd.isna(crash) or pd.isna(rally):
            return "Unavailable"
        if crash >= 60:
            return "Crisis"
        if rally >= 90:
            return "Euphoria"
        if crash >= 40:
            return "Caution"
        if 78 <= rally < 90 and crash < 40:
            return "Rally"
        return "Normal"

    history["regime"] = history.apply(classify, axis=1)
    exposure_map = {"Crisis": 0.0, "Euphoria": 0.0, "Caution": 0.7, "Rally": 1.5, "Normal": 1.0, "Unavailable": np.nan}
    history["exposure"] = history["regime"].map(exposure_map)

    if prior20_results is None:
        prior20_results = estimator_results(returns, max(119, len(returns) - 21))
    return history, latest_results, prior20_results


def stress_percentile(history: pd.DataFrame, metric_column: str, inverse: bool = False) -> float:
    value = history[metric_column].dropna()
    if value.empty:
        return 50.0
    pct = float(value.rank(pct=True).iloc[-1] * 100.0)
    return 100.0 - pct if inverse else pct


def current_driver_bundle(history: pd.DataFrame) -> dict[str, Any]:
    latest = history.iloc[-1]
    crash_specs = [
        ("ar1", "One-factor absorption ratio", 0.20, float(latest["p_ar1"])),
        ("effective_rank", "Effective rank deterioration", 0.20, 100.0 - float(latest["p_effective_rank"])),
        ("edge_density_05", "Strong-connection share", 0.15, float(latest["p_density"])),
        ("clustering", "Clustering coefficient", 0.10, float(latest["p_clustering"])),
        ("realized_vol_20d", "20-day realised volatility", 0.15, float(latest["p_vol"])),
        ("drawdown_60d", "60-day drawdown", 0.10, float(latest["p_drawdown60"])),
        ("price_vs_sma50", "Price versus 50-day average", 0.10, float(latest["p_trend_oversold"])),
    ]
    rally_specs = [
        ("drawdown_60d", "60-day drawdown", 0.25, float(latest["p_drawdown60"])),
        ("drawdown_20d", "20-day drawdown", 0.15, float(latest["p_drawdown20"])),
        ("return_5d", "Five-day reversal", 0.20, float(latest["p_return5"])),
        ("price_vs_sma50", "Price versus 50-day average", 0.20, float(latest["p_trend_oversold"])),
        ("realized_vol_20d", "Volatility opportunity", 0.10, float(100.0 - abs(latest["p_vol"] - 65.0) * 1.6)),
        ("breadth_20d", "Cross-asset breadth balance", 0.10, float(100.0 - abs(latest["breadth_20d"] * 100.0 - 48.0) * 2.0)),
    ]

    def make(specs: Iterable[tuple[str, str, float, float]]) -> list[dict[str, Any]]:
        output = []
        for key, label, weight, percentile in specs:
            percentile = float(np.clip(percentile, 0, 100))
            contribution = weight * (percentile - 50.0) / 50.0
            explanation = EXPLANATIONS.get(key, {})
            output.append(
                {
                    "key": key,
                    "label": label,
                    "percentile": round(percentile, 1),
                    "contribution": round(contribution, 4),
                    "direction": "raises" if contribution >= 0 else "reduces",
                    "explanation": explanation,
                }
            )
        return sorted(output, key=lambda item: abs(item["contribution"]), reverse=True)

    crash = make(crash_specs)
    rally = make(rally_specs)
    spectral_keys = {"ar1", "effective_rank", "edge_density_05", "clustering"}
    spectral_abs = sum(abs(item["contribution"]) for item in crash if item["key"] in spectral_keys)
    total_abs = sum(abs(item["contribution"]) for item in crash) or 1.0
    return {"crash": crash, "rally": rally, "crash_spectral_share": round(spectral_abs / total_abs * 100.0, 1)}


def asset_network_rows(
    prices: pd.DataFrame,
    latest: dict[str, EstimatorResult],
    prior20: dict[str, EstimatorResult],
) -> list[dict[str, Any]]:
    matrix = latest["composite"].matrix
    previous = prior20["composite"].matrix
    threshold = 0.50
    degree = (np.abs(matrix) > threshold).sum(axis=1) - 1
    average = (np.abs(matrix).sum(axis=1) - 1.0) / (len(TICKERS) - 1)
    returns1 = prices.pct_change().iloc[-1]
    returns5 = prices.iloc[-1] / prices.iloc[-6] - 1.0
    rows: list[dict[str, Any]] = []
    spy_index = TICKERS.index("SPY")
    for i, meta in enumerate(ASSETS):
        ticker = meta["ticker"]
        values = matrix[i].copy()
        values[i] = 0.0
        strongest_index = int(np.argmax(np.abs(values)))
        strongest_value = float(matrix[i, strongest_index])
        spy_corr = float(matrix[i, spy_index]) if i != spy_index else 1.0
        corr_change = float(average[i] - ((np.abs(previous[i]).sum() - 1.0) / (len(TICKERS) - 1)))
        if degree[i] >= np.quantile(degree, 0.70):
            network_role = "System hub"
            meaning = "A core part of the current market network; owning several hubs may duplicate the same risk exposure."
        elif ticker in {"TLT", "IEF"}:
            network_role = "Duration offset"
            meaning = "May offset growth shocks, but can fail when inflation and yields rise together."
        elif ticker in {"GLD", "UUP"}:
            network_role = "Defensive offset"
            meaning = "Relatively defensive relationship; confirm that the offset remains stable in the current macro regime."
        elif ticker in {"XLE", "USO"}:
            network_role = "Inflation / energy node"
            meaning = "Primarily linked to energy and inflation dynamics rather than only broad equity beta."
        elif degree[i] <= np.quantile(degree, 0.25):
            network_role = "Peripheral diversifier"
            meaning = "Fewer strong links may provide diversification, but low centrality is not automatically bullish."
        else:
            network_role = "Cluster member"
            meaning = "Mostly connected to a specific asset cluster rather than the entire system."
        rows.append(
            {
                **meta,
                "latest_price": _safe_float(prices[ticker].iloc[-1], 4),
                "return_1d": _safe_float(returns1[ticker], 6),
                "return_5d": _safe_float(returns5[ticker], 6),
                "avg_abs_corr": _safe_float(average[i], 4),
                "strong_links": int(degree[i]),
                "strongest_link": {"ticker": TICKERS[strongest_index], "correlation": round(strongest_value, 4)},
                "spy_correlation": round(spy_corr, 4),
                "avg_abs_corr_change_20d": round(corr_change, 4),
                "network_role": network_role,
                "portfolio_meaning": meaning,
            }
        )
    return sorted(rows, key=lambda item: (item["strong_links"], item["avg_abs_corr"]), reverse=True)


def estimator_payload(
    name: str,
    current: EstimatorResult,
    prior20: EstimatorResult,
    history: pd.DataFrame,
) -> dict[str, Any]:
    prefix = name
    metrics: dict[str, Any] = {}
    inverse = {"effective_rank"}
    for key, value in current.metrics.items():
        column = f"{prefix}_{key}"
        pct = stress_percentile(history, column, inverse=key in inverse) if column in history else 50.0
        previous = prior20.metrics.get(key)
        metrics[key] = {
            "value": _safe_float(value, 6),
            "change_20d": _safe_float(value - previous, 6) if previous is not None else None,
            "stress_percentile": round(float(pct), 1),
            "explanation": EXPLANATIONS.get(key, {}),
        }
    return {
        "label": {"ewm": "EWM · 30D half-life", "60d": "Rolling · 60D", "120d": "Rolling · 120D", "composite": "Composite / All"}[name],
        "sample_size": current.sample_size,
        "matrix": np.round(current.matrix, 5).tolist(),
        "metrics": metrics,
    }


def confirmation_status(history: pd.DataFrame) -> dict[str, Any]:
    latest = history.iloc[-1]
    details: dict[str, bool] = {}
    for estimator in ["ewm", "60d", "120d"]:
        p_ar1 = stress_percentile(history, f"{estimator}_ar1")
        p_rank = stress_percentile(history, f"{estimator}_effective_rank", inverse=True)
        p_density = stress_percentile(history, f"{estimator}_edge_density_05")
        details[estimator] = bool((p_ar1 + p_rank + p_density) / 3.0 >= 65.0)
    count = sum(details.values())
    message = {
        0: "No broad structural warning across the three estimators.",
        1: "Early warning: one estimator is deteriorating, usually the fastest lens.",
        2: "Tactical warning confirmed by two of the three estimator horizons.",
        3: "Broad and persistent deterioration across all three estimator horizons.",
    }[count]
    return {"count": count, "total": 3, "details": details, "message": message, "latest_composite_ar1": _safe_float(latest["composite_ar1"])}


def regime_summary(regime: str, rally_rank: float, crash_rank: float, confirmation: int) -> dict[str, str]:
    if regime == "Crisis":
        return {
            "headline": "Capital preservation has priority.",
            "interpretation": "Crash risk has crossed the paper-style danger threshold. Broad beta should be reduced until the signal exits the danger zone.",
            "action": "Reduce broad equity beta; compare direct de-risking with the cost of options protection.",
            "invalidation": "Crash rank falls below 60 and structural confirmation weakens for multiple sessions.",
        }
    if regime == "Euphoria":
        return {
            "headline": "Do not confuse confidence with asymmetry.",
            "interpretation": "The rally rank is extremely high and may indicate an overextended, crowded market rather than a better entry point.",
            "action": "Avoid chasing; trim crowded winners and favour defined-risk expressions.",
            "invalidation": "Rally rank returns below 90 without a simultaneous rise in crash risk.",
        }
    if regime == "Caution":
        return {
            "headline": "Keep exposure, but raise the hurdle.",
            "interpretation": f"Crash rank is elevated at {crash_rank:.0f}; {confirmation} of 3 estimator horizons currently confirm structural deterioration.",
            "action": "Reduce marginal risk, avoid new leverage, and require stronger catalyst and breadth confirmation.",
            "invalidation": "Crash rank falls below 40 while effective rank and breadth improve.",
        }
    if regime == "Rally":
        return {
            "headline": "Constructive rally sweet spot.",
            "interpretation": f"Rally rank is {rally_rank:.0f} while crash risk remains contained.",
            "action": "Increase risk selectively in the strongest catalyst-backed opportunities, not indiscriminate beta.",
            "invalidation": "Rally rank exits the 78–90 range or crash rank rises above 40.",
        }
    return {
        "headline": "Use the normal risk budget.",
        "interpretation": "The model does not identify an unusually strong rally or crash configuration.",
        "action": "Let security selection, catalysts, valuation, and position-specific risk drive exposure.",
        "invalidation": "Crash rank rises above 40 or correlation deterioration broadens across estimators.",
    }


def build_history_payload(prices: pd.DataFrame, history: pd.DataFrame) -> list[dict[str, Any]]:
    merged = prices[["SPY", "QQQ", "IWM"]].join(
        history[[
            "rally_score", "crash_score", "rally_rank", "crash_rank", "regime", "exposure",
            "composite_effective_rank", "composite_edge_density_05", "composite_ar1",
            "drawdown_20d", "drawdown_60d", "realized_vol_20d", "breadth_20d",
        ]],
        how="left",
    )
    cutoff = merged.index.max() - pd.DateOffset(years=11)
    merged = merged.loc[merged.index >= cutoff]
    rolling_1y = merged[["SPY", "QQQ", "IWM"]].pct_change(252)
    payload: list[dict[str, Any]] = []
    for idx, row in merged.iterrows():
        payload.append(
            {
                "date": idx.date().isoformat(),
                "SPY": _safe_float(row["SPY"], 4),
                "QQQ": _safe_float(row["QQQ"], 4),
                "IWM": _safe_float(row["IWM"], 4),
                "SPY_rolling_1y": _safe_float(rolling_1y.loc[idx, "SPY"], 6),
                "QQQ_rolling_1y": _safe_float(rolling_1y.loc[idx, "QQQ"], 6),
                "IWM_rolling_1y": _safe_float(rolling_1y.loc[idx, "IWM"], 6),
                "rally_score": _safe_float(row.get("rally_score"), 3),
                "crash_score": _safe_float(row.get("crash_score"), 3),
                "rally_rank": _safe_float(row.get("rally_rank"), 2),
                "crash_rank": _safe_float(row.get("crash_rank"), 2),
                "regime": None if pd.isna(row.get("regime")) else str(row.get("regime")),
                "exposure": _safe_float(row.get("exposure"), 2),
                "effective_rank": _safe_float(row.get("composite_effective_rank"), 3),
                "edge_density_05": _safe_float(row.get("composite_edge_density_05"), 5),
                "ar1": _safe_float(row.get("composite_ar1"), 5),
                "drawdown_20d": _safe_float(row.get("drawdown_20d"), 6),
                "drawdown_60d": _safe_float(row.get("drawdown_60d"), 6),
                "realized_vol_20d": _safe_float(row.get("realized_vol_20d"), 6),
                "breadth_20d": _safe_float(row.get("breadth_20d"), 6),
            }
        )
    return payload


def performance_by_regime(history: pd.DataFrame, prices: pd.DataFrame) -> list[dict[str, Any]]:
    spy = prices["SPY"].reindex(history.index)
    forward10 = spy.shift(-10) / spy - 1.0
    future_drawdown10 = pd.Series(index=history.index, dtype=float)
    values = spy.to_numpy()
    for i in range(len(values) - 10):
        future_drawdown10.iloc[i] = float(np.min(values[i + 1 : i + 11] / values[i] - 1.0))
    frame = pd.DataFrame({"regime": history["regime"], "forward10": forward10, "drawdown10": future_drawdown10}).dropna()
    output: list[dict[str, Any]] = []
    for regime in ["Normal", "Rally", "Caution", "Crisis", "Euphoria"]:
        subset = frame[frame["regime"] == regime]
        if subset.empty:
            continue
        transitions = (frame["regime"] != frame["regime"].shift(1)) & (frame["regime"] == regime)
        episodes = int(transitions.sum())
        output.append(
            {
                "regime": regime,
                "observations": int(len(subset)),
                "episodes": episodes,
                "median_forward_10d": _safe_float(subset["forward10"].median(), 6),
                "positive_hit_rate_10d": _safe_float((subset["forward10"] > 0).mean(), 6),
                "median_max_drawdown_10d": _safe_float(subset["drawdown10"].median(), 6),
                "worst_forward_10d": _safe_float(subset["forward10"].min(), 6),
            }
        )
    return output


def validate_bundle(bundle: dict[str, Any]) -> None:
    if bundle["meta"]["universe_count"] != 24:
        raise ValueError("Universe count is not 24")
    for estimator in ["composite", "ewm", "60d", "120d"]:
        matrix = np.asarray(bundle["estimators"][estimator]["matrix"], dtype=float)
        if matrix.shape != (24, 24):
            raise ValueError(f"{estimator} matrix has wrong shape")
        if not np.allclose(matrix, matrix.T, atol=1e-5):
            raise ValueError(f"{estimator} matrix is not symmetric")
        if not np.allclose(np.diag(matrix), 1.0, atol=1e-5):
            raise ValueError(f"{estimator} matrix diagonal is not one")
        if np.nanmax(np.abs(matrix)) > 1.00001:
            raise ValueError(f"{estimator} matrix contains invalid correlations")
    if len(bundle["assets"]) != 24:
        raise ValueError("Asset role table does not contain 24 rows")
    if len(bundle["history"]) < 1_000:
        raise ValueError("History payload is too short")
    if bundle["current"]["regime"] not in {"Normal", "Rally", "Caution", "Crisis", "Euphoria"}:
        raise ValueError("Invalid current regime")


def build_bundle(mode: str, start: str) -> dict[str, Any]:
    if mode == "live":
        token = os.environ.get("EODHD_API_TOKEN", "").strip()
        if not token:
            raise RuntimeError("EODHD_API_TOKEN missing")
        prices, quality = load_live_prices(token, start)
    elif mode == "demo":
        prices, quality = generate_demo_prices()
    else:
        raise ValueError(f"Unsupported mode: {mode}")

    prices = prices[TICKERS].astype(float).sort_index()
    history, latest, prior20 = calculate_history(prices)
    valid_history = history.dropna(subset=["rally_rank", "crash_rank"])
    if valid_history.empty:
        raise RuntimeError("No valid rally/crash rank history was produced")
    current_row = valid_history.iloc[-1]
    confirmation = confirmation_status(history)
    regime = str(current_row["regime"])
    rally_rank = float(current_row["rally_rank"])
    crash_rank = float(current_row["crash_rank"])
    exposure = float(current_row["exposure"])
    freed = max(0.0, 1.0 - min(exposure, 1.0))

    estimators = {
        name: estimator_payload(name, latest[name], prior20[name], history)
        for name in ["composite", "ewm", "60d", "120d"]
    }
    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    bundle: dict[str, Any] = {
        "meta": {
            "schema_version": SCHEMA_VERSION,
            "model_version": MODEL_VERSION,
            "generated_at_utc": generated_at,
            "data_mode": mode,
            "source": "EODHD adjusted close" if mode == "live" else "Deterministic synthetic demo",
            "latest_market_date": prices.index.max().date().isoformat(),
            "earliest_common_date": prices.index.min().date().isoformat(),
            "universe_count": len(TICKERS),
            "model_status": "Transparent ORCA-Lite approximation; not an exact replication of the paper's Random Forest.",
            "warning": "Risk context, not a deterministic forecast or standalone trading recommendation.",
        },
        "quality": quality,
        "universe": ASSETS,
        "current": {
            "date": valid_history.index[-1].date().isoformat(),
            "rally_score": round(float(current_row["rally_score"]), 2),
            "crash_score": round(float(current_row["crash_score"]), 2),
            "rally_rank": round(rally_rank, 1),
            "crash_rank": round(crash_rank, 1),
            "regime": regime,
            "suggested_equity_exposure": round(exposure, 2),
            "defensive_allocation_of_freed_capital": {"GLD": round(freed * 0.50, 3), "IEF": round(freed * 0.30, 3), "UUP": round(freed * 0.20, 3)},
            "confirmation": confirmation,
            "summary": regime_summary(regime, rally_rank, crash_rank, confirmation["count"]),
        },
        "estimators": estimators,
        "assets": asset_network_rows(prices, latest, prior20),
        "drivers": current_driver_bundle(history),
        "history": build_history_payload(prices, history),
        "performance_by_regime": performance_by_regime(history, prices),
        "audit": {
            "no_forward_fill": True,
            "no_xlre_backfill": True,
            "point_in_time_note": "All displayed current metrics use data available through the stated latest market date.",
            "research_view_note": "Forward-return statistics are ex-post research outputs and must not appear as live information for historical dates.",
            "paper_ambiguities": [
                "The paper states 127 spectral plus 79 traditional features, while a results table reports a different split.",
                "The paper's stated walk-forward test duration and strategy backtest duration are not fully reconciled.",
                "XLRE launched in 2015; this implementation does not synthesize or backfill pre-inception XLRE history.",
            ],
            "validation": {"matrix_symmetry": "pass", "matrix_diagonal": "pass", "universe_count": "pass", "history_length": "pass"},
        },
    }
    validate_bundle(bundle)
    return bundle


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the ORCA dashboard JSON bundle")
    parser.add_argument("--mode", choices=["live", "demo"], default="live")
    parser.add_argument("--from-date", default=DEFAULT_FROM)
    parser.add_argument("--output", default="orca/data/dashboard.json")
    args = parser.parse_args()
    try:
        bundle = build_bundle(args.mode, args.from_date)
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(bundle, indent=2, sort_keys=False, allow_nan=False), encoding="utf-8")
        print(f"Wrote {output} ({output.stat().st_size:,} bytes)")
        print(f"Mode: {bundle['meta']['data_mode']} | Latest: {bundle['meta']['latest_market_date']} | Regime: {bundle['current']['regime']}")
        return 0
    except Exception as exc:  # noqa: BLE001 - CLI should fail clearly without exposing credentials.
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
