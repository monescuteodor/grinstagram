"""The AI part: a gradient-boosted classifier that estimates the probability
that price will rise enough over the next few candles to cover fees.

Before the model is allowed to trade it is validated walk-forward
(train on the past, test on the following unseen period). If its buy signals
are not measurably better than chance on unseen data, `tradeable` is False and
the bot will not open new positions with it.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.model_selection import TimeSeriesSplit

from .config import Config
from .features import FEATURE_COLUMNS, add_features, make_labels

log = logging.getLogger(__name__)

MIN_TRAIN_ROWS = 500
MIN_OOS_SIGNALS = 20


def _new_classifier() -> HistGradientBoostingClassifier:
    return HistGradientBoostingClassifier(
        max_iter=150,
        learning_rate=0.03,
        max_depth=3,
        min_samples_leaf=100,
        l2_regularization=1.0,
        random_state=42,
    )


class SignalModel:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.clf: HistGradientBoostingClassifier | None = None
        self.trained_at: datetime | None = None
        self.tradeable = False
        self.metrics: dict = {}

    def train(self, ohlcv: pd.DataFrame) -> dict:
        X = add_features(ohlcv)
        y = make_labels(ohlcv, self.cfg.label_horizon, self.cfg.fee_rate)
        data = X.join(y.rename("y")).dropna()
        if len(data) < MIN_TRAIN_ROWS:
            raise ValueError(f"Not enough data to train ({len(data)} rows, need {MIN_TRAIN_ROWS})")
        Xd, yd = data[FEATURE_COLUMNS], data["y"].astype(int)

        # Walk-forward validation; the gap stops labels from leaking across folds.
        hits = signals = 0
        base_rates, fold_edges = [], []
        for tr, te in TimeSeriesSplit(n_splits=4, gap=self.cfg.label_horizon).split(Xd):
            if yd.iloc[tr].nunique() < 2:
                continue
            clf = clone(_new_classifier()).fit(Xd.iloc[tr], yd.iloc[tr])
            proba = clf.predict_proba(Xd.iloc[te])[:, 1]
            picked = proba >= self.cfg.buy_threshold
            hits += int(yd.iloc[te][picked].sum())
            signals += int(picked.sum())
            base_rates.append(float(yd.iloc[te].mean()))
            if picked.any():
                fold_edges.append(float(yd.iloc[te][picked].mean()) - base_rates[-1])

        base_rate = float(np.mean(base_rates)) if base_rates else 0.0
        precision = hits / signals if signals else 0.0
        edge = precision - base_rate
        # Require the edge overall AND in most individual periods, so one lucky fold can't pass.
        positive_folds = sum(e > 0 for e in fold_edges)
        self.tradeable = (signals >= MIN_OOS_SIGNALS and edge >= self.cfg.min_model_edge
                          and positive_folds >= 3)

        if yd.nunique() < 2:
            raise ValueError("Training labels contain a single class")
        self.clf = _new_classifier().fit(Xd, yd)
        self.trained_at = datetime.now(timezone.utc)
        self.metrics = {
            "rows": len(Xd),
            "oos_signals": signals,
            "oos_precision": round(precision, 4),
            "base_rate": round(base_rate, 4),
            "edge": round(edge, 4),
            "positive_folds": f"{positive_folds}/{len(fold_edges)}",
            "tradeable": self.tradeable,
        }
        return self.metrics

    def predict_proba(self, features: pd.DataFrame) -> np.ndarray:
        """Probabilities for each row of an already-computed feature frame (NaN rows -> 0.5)."""
        if self.clf is None:
            raise RuntimeError("Model is not trained")
        out = np.full(len(features), 0.5)
        ok = features.notna().all(axis=1).to_numpy()
        if ok.any():
            out[ok] = self.clf.predict_proba(features[ok])[:, 1]
        return out

    def predict_latest(self, ohlcv: pd.DataFrame) -> float:
        return float(self.predict_proba(add_features(ohlcv).iloc[[-1]])[0])

    def is_stale(self) -> bool:
        if self.trained_at is None:
            return True
        age_h = (datetime.now(timezone.utc) - self.trained_at).total_seconds() / 3600
        return age_h >= self.cfg.retrain_hours

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump({"clf": self.clf, "trained_at": self.trained_at,
                     "tradeable": self.tradeable, "metrics": self.metrics}, path)

    @classmethod
    def load(cls, cfg: Config, path: Path) -> "SignalModel":
        model = cls(cfg)
        if path.exists():
            try:
                blob = joblib.load(path)
                model.clf, model.trained_at = blob["clf"], blob["trained_at"]
                model.tradeable, model.metrics = blob["tradeable"], blob["metrics"]
            except Exception:  # corrupt or incompatible file: just retrain
                log.warning("Could not load model %s, will retrain", path)
        return model
