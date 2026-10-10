"""Technical features and training labels.

Every feature at row t uses only data up to and including candle t, so the
model never sees the future. Labels look ahead and are used only for training.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

FEATURE_COLUMNS = [
    "ret_1", "ret_3", "ret_6", "ret_12", "ret_24",
    "rsi_14", "macd_hist", "bb_pos", "atr_pct", "vol_z",
    "ema_20_50", "ema_50_200", "volatility_24", "range_pct",
    "hour_sin", "hour_cos",
]


def atr(df: pd.DataFrame, n: int = 14) -> pd.Series:
    prev_close = df["close"].shift(1)
    tr = pd.concat([
        df["high"] - df["low"],
        (df["high"] - prev_close).abs(),
        (df["low"] - prev_close).abs(),
    ], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / n, adjust=False, min_periods=n).mean()


def rsi(close: pd.Series, n: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    rs = gain / loss.replace(0, np.nan)
    return (100 - 100 / (1 + rs)).fillna(100.0).where(loss.notna())


def add_features(df: pd.DataFrame) -> pd.DataFrame:
    c, v = df["close"], df["volume"]
    out = pd.DataFrame(index=df.index)
    for n in (1, 3, 6, 12, 24):
        out[f"ret_{n}"] = c.pct_change(n)
    out["rsi_14"] = rsi(c) / 100.0

    ema12, ema26 = c.ewm(span=12, adjust=False).mean(), c.ewm(span=26, adjust=False).mean()
    macd = (ema12 - ema26) / c
    out["macd_hist"] = macd - macd.ewm(span=9, adjust=False).mean()

    sma20, std20 = c.rolling(20).mean(), c.rolling(20).std()
    out["bb_pos"] = (c - sma20) / (2 * std20)
    out["atr_pct"] = atr(df) / c
    out["vol_z"] = (v - v.rolling(48).mean()) / v.rolling(48).std()

    ema20 = c.ewm(span=20, adjust=False).mean()
    ema50 = c.ewm(span=50, adjust=False).mean()
    ema200 = c.ewm(span=200, adjust=False).mean()
    out["ema_20_50"] = ema20 / ema50 - 1
    out["ema_50_200"] = ema50 / ema200 - 1
    out["volatility_24"] = out["ret_1"].rolling(24).std()
    out["range_pct"] = (df["high"] - df["low"]) / c

    hours = df.index.hour + df.index.minute / 60.0
    out["hour_sin"] = np.sin(2 * np.pi * hours / 24)
    out["hour_cos"] = np.cos(2 * np.pi * hours / 24)

    # EMA200 needs time to warm up; drop the unreliable start.
    out.iloc[:200] = np.nan
    return out.replace([np.inf, -np.inf], np.nan)[FEATURE_COLUMNS]


def make_labels(df: pd.DataFrame, horizon: int, fee_rate: float) -> pd.Series:
    """1 if price `horizon` candles later beats round-trip costs with a margin."""
    fwd = df["close"].shift(-horizon) / df["close"] - 1
    threshold = 3 * fee_rate
    labels = (fwd > threshold).astype(float)
    return labels.where(fwd.notna())
