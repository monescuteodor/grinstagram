"""Position sizing, stops and account-level kill switches."""
from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import datetime

from .config import Config


@dataclass
class Position:
    symbol: str
    amount: float
    entry_price: float
    stop: float
    take_profit: float
    opened_at: str

    def to_dict(self) -> dict:
        return asdict(self)


def size_quote(cfg: Config, equity: float, cash: float, price: float, atr_value: float) -> float:
    """How much quote currency to spend so that hitting the stop loses ~risk_per_trade of equity."""
    stop_distance = cfg.stop_loss_atr * atr_value
    if stop_distance <= 0 or price <= 0 or equity <= 0:
        return 0.0
    by_risk = equity * cfg.risk_per_trade / stop_distance * price
    return max(0.0, min(by_risk, equity * cfg.max_position_pct, cash * 0.99))


def initial_levels(cfg: Config, price: float, atr_value: float) -> tuple[float, float]:
    return price - cfg.stop_loss_atr * atr_value, price + cfg.take_profit_atr * atr_value


def update_trailing(cfg: Config, pos: Position, price: float, atr_value: float) -> None:
    if cfg.trailing_stop:
        pos.stop = max(pos.stop, price - cfg.stop_loss_atr * atr_value)


def exit_reason(cfg: Config, pos: Position, low: float, high: float, prob: float | None) -> str | None:
    if low <= pos.stop:
        return "stop_loss"
    if high >= pos.take_profit:
        return "take_profit"
    if prob is not None and prob <= cfg.sell_threshold:
        return "model_exit"
    return None


@dataclass
class AccountGuard:
    """Tracks peak equity and daily P&L; decides when trading must pause or stop."""
    peak_equity: float = 0.0
    day: str = ""
    day_start_equity: float = 0.0
    killed: bool = False
    kill_reason: str = ""

    def check(self, cfg: Config, equity: float, now: datetime) -> str:
        """Return 'ok', 'daily_pause' (no new entries today) or 'kill' (close all, stop)."""
        if self.killed:
            return "kill"
        today = now.strftime("%Y-%m-%d")
        if today != self.day:
            self.day, self.day_start_equity = today, equity
        self.peak_equity = max(self.peak_equity, equity)

        if self.peak_equity > 0 and equity < self.peak_equity * (1 - cfg.max_drawdown_pct):
            self.killed = True
            self.kill_reason = (f"equity {equity:.2f} fell more than {cfg.max_drawdown_pct:.0%} "
                                f"below peak {self.peak_equity:.2f}")
            return "kill"
        if self.day_start_equity > 0 and equity < self.day_start_equity * (1 - cfg.daily_loss_limit_pct):
            return "daily_pause"
        return "ok"
