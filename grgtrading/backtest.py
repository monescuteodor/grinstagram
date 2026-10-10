"""Walk-forward backtest: the model is retrained periodically on past data only
and trades the following unseen period, with fees, slippage and the same
risk rules the live bot uses."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

from .config import Config
from .features import add_features, atr
from .model import SignalModel
from .risk import Position, exit_reason, initial_levels, order_size, update_trailing


def run_backtest(df: pd.DataFrame, cfg: Config, train_candles: int = 2000,
                 retrain_every: int = 250, exchange_min: float = 5.0) -> dict:
    if len(df) < train_candles + 100:
        raise ValueError(f"Need at least {train_candles + 100} candles, got {len(df)}")
    feats = add_features(df)
    atrs = atr(df).to_numpy()
    o, h, l, c = (df[k].to_numpy() for k in ("open", "high", "low", "close"))

    cash, pos = cfg.starting_balance, None
    equity_curve, trades = [], []
    probs = np.full(len(df), np.nan)
    tradeable_blocks = total_blocks = 0
    model = SignalModel(cfg)

    def sell(price: float, reason: str, i: int):
        nonlocal cash, pos
        price *= 1 - cfg.slippage
        proceeds = pos.amount * price * (1 - cfg.fee_rate)
        cost_basis = pos.amount * pos.entry_price * (1 + cfg.fee_rate)
        cash += proceeds
        trades.append({"exit_time": df.index[i], "pnl": proceeds - cost_basis, "reason": reason})
        pos = None

    for i in range(train_candles, len(df)):
        if (i - train_candles) % retrain_every == 0:
            model.train(df.iloc[:i])  # labels for the last rows are NaN -> no look-ahead
            end = min(i + retrain_every, len(df))
            block = model.predict_proba(feats.iloc[i:end])
            probs[i:end] = block if model.tradeable else np.nan
            total_blocks += 1
            tradeable_blocks += model.tradeable
        prob = probs[i]

        if pos:
            # Stop/take-profit hit inside candle i (gap through the stop fills at the open).
            reason = exit_reason(cfg, pos, l[i], h[i], None)
            if reason == "stop_loss":
                sell(min(o[i], pos.stop), reason, i)
            elif reason == "take_profit":
                sell(max(o[i], pos.take_profit), reason, i)
            elif not math.isnan(prob) and prob <= cfg.sell_threshold:
                sell(c[i], "model_exit", i)
            else:
                update_trailing(cfg, pos, c[i], atrs[i])

        if pos is None and not math.isnan(prob) and prob >= cfg.buy_threshold:
            equity = cash
            quote = order_size(cfg, equity, cash, c[i], atrs[i], exchange_min)
            if quote > 0:
                price = c[i] * (1 + cfg.slippage)
                amount = quote * (1 - cfg.fee_rate) / price
                stop, tp = initial_levels(cfg, price, atrs[i])
                pos = Position("bt", amount, price, stop, tp, str(df.index[i]))
                cash -= quote
        equity_curve.append(cash + (pos.amount * c[i] if pos else 0.0))

    if pos:
        sell(c[-1], "end_of_test", len(df) - 1)
        equity_curve[-1] = cash

    eq = pd.Series(equity_curve, index=df.index[train_candles:])
    rets = eq.pct_change().dropna()
    periods_per_year = 365 * 24 * 3600 / (df.index[1] - df.index[0]).total_seconds()
    pnls = [t["pnl"] for t in trades]
    wins = [p for p in pnls if p > 0]
    losses = [-p for p in pnls if p <= 0]
    return {
        "period": f"{eq.index[0]:%Y-%m-%d} -> {eq.index[-1]:%Y-%m-%d}",
        "start_equity": cfg.starting_balance,
        "end_equity": round(eq.iloc[-1], 2),
        "total_return_pct": round((eq.iloc[-1] / cfg.starting_balance - 1) * 100, 2),
        "buy_and_hold_pct": round((c[-1] / c[train_candles] - 1) * 100, 2),
        "max_drawdown_pct": round(((eq / eq.cummax()) - 1).min() * 100, 2),
        "sharpe": round(rets.mean() / rets.std() * math.sqrt(periods_per_year), 2) if rets.std() > 0 else 0.0,
        "trades": len(trades),
        "win_rate": round(len(wins) / len(trades), 3) if trades else None,
        "profit_factor": round(sum(wins) / sum(losses), 2) if losses and sum(losses) > 0 else None,
        "model_tradeable_share": round(tradeable_blocks / total_blocks, 2) if total_blocks else 0,
        "equity_curve": eq,
    }
