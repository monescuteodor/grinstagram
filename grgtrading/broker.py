"""Exchange access. PaperBroker simulates fills on real market prices;
LiveBroker sends real market orders through ccxt."""
from __future__ import annotations

import logging
from dataclasses import dataclass

import ccxt
import pandas as pd

from .config import Config

log = logging.getLogger(__name__)


@dataclass
class Fill:
    amount: float   # base currency received (buy) or sold (sell)
    price: float
    cost: float     # quote currency spent (buy) or received (sell), after fees
    fee: float      # in quote currency


class Broker:
    def __init__(self, cfg: Config, exchange: ccxt.Exchange):
        self.cfg = cfg
        self.exchange = exchange

    def fetch_ohlcv(self, symbol: str, limit: int) -> pd.DataFrame:
        """Fetch the last `limit` candles, paging past the exchange's per-request cap."""
        tf_ms = self.exchange.parse_timeframe(self.cfg.timeframe) * 1000
        now = self.exchange.milliseconds()
        since = now - tf_ms * (limit + 1)
        rows: list[list] = []
        while since < now:
            batch = self.exchange.fetch_ohlcv(symbol, self.cfg.timeframe, since=since, limit=1000)
            if not batch:
                break
            rows.extend(batch)
            if batch[-1][0] + tf_ms >= now or batch[-1][0] < since:
                break
            since = batch[-1][0] + tf_ms
        return candles_to_frame(rows).tail(limit)

    def last_price(self, symbol: str) -> float:
        return float(self.exchange.fetch_ticker(symbol)["last"])

    def min_cost(self, symbol: str) -> float:
        try:
            limits = self.exchange.market(symbol)["limits"]
            return float((limits.get("cost") or {}).get("min") or 0.0)
        except Exception:
            return 0.0

    # Overridden below
    def cash(self) -> float: ...
    def base_amount(self, symbol: str) -> float: ...
    def buy(self, symbol: str, quote_amount: float) -> Fill: ...
    def sell(self, symbol: str, amount: float) -> Fill: ...


def candles_to_frame(rows: list[list]) -> pd.DataFrame:
    df = pd.DataFrame(rows, columns=["ts", "open", "high", "low", "close", "volume"])
    df = df.drop_duplicates("ts").sort_values("ts")
    df.index = pd.to_datetime(df.pop("ts"), unit="ms", utc=True)
    return df.astype(float)


class PaperBroker(Broker):
    def __init__(self, cfg: Config, exchange: ccxt.Exchange, balances: dict | None = None):
        super().__init__(cfg, exchange)
        self.balances: dict[str, float] = balances or {cfg.quote: cfg.starting_balance}

    def cash(self) -> float:
        return self.balances.get(self.cfg.quote, 0.0)

    def base_amount(self, symbol: str) -> float:
        return self.balances.get(symbol.split("/")[0], 0.0)

    def buy(self, symbol: str, quote_amount: float) -> Fill:
        quote_amount = min(quote_amount, self.cash())
        price = self.last_price(symbol) * (1 + self.cfg.slippage)
        fee = quote_amount * self.cfg.fee_rate
        amount = (quote_amount - fee) / price
        base = symbol.split("/")[0]
        self.balances[self.cfg.quote] = self.cash() - quote_amount
        self.balances[base] = self.balances.get(base, 0.0) + amount
        return Fill(amount, price, quote_amount, fee)

    def sell(self, symbol: str, amount: float) -> Fill:
        base = symbol.split("/")[0]
        amount = min(amount, self.base_amount(symbol))
        price = self.last_price(symbol) * (1 - self.cfg.slippage)
        gross = amount * price
        fee = gross * self.cfg.fee_rate
        self.balances[base] = self.base_amount(symbol) - amount
        self.balances[self.cfg.quote] = self.cash() + gross - fee
        return Fill(amount, price, gross - fee, fee)


class LiveBroker(Broker):
    def cash(self) -> float:
        return float(self.exchange.fetch_balance()["free"].get(self.cfg.quote, 0.0) or 0.0)

    def base_amount(self, symbol: str) -> float:
        base = symbol.split("/")[0]
        return float(self.exchange.fetch_balance()["free"].get(base, 0.0) or 0.0)

    def _settle(self, order: dict, symbol: str) -> dict:
        if order.get("filled") is None or order.get("average") is None:
            order = self.exchange.fetch_order(order["id"], symbol)
        return order

    @staticmethod
    def _fee_in_quote(order: dict, quote: str, price: float) -> float:
        fee = order.get("fee") or {}
        cost = float(fee.get("cost") or 0.0)
        return cost if fee.get("currency") == quote else cost * price

    def buy(self, symbol: str, quote_amount: float) -> Fill:
        if self.exchange.has.get("createMarketBuyOrderWithCost"):
            cost = float(self.exchange.cost_to_precision(symbol, quote_amount))
            order = self.exchange.create_market_buy_order_with_cost(symbol, cost)
        else:
            price = self.last_price(symbol)
            amount = float(self.exchange.amount_to_precision(symbol, quote_amount / price))
            order = self.exchange.create_market_buy_order(symbol, amount)
        order = self._settle(order, symbol)
        price = float(order["average"])
        # Some exchanges take the fee out of the base asset: trust the wallet.
        received = min(float(order["filled"]), self.base_amount(symbol))
        log.info("LIVE BUY %s: %s", symbol, order.get("id"))
        return Fill(received, price, float(order.get("cost") or received * price),
                    self._fee_in_quote(order, self.cfg.quote, price))

    def sell(self, symbol: str, amount: float) -> Fill:
        amount = float(self.exchange.amount_to_precision(symbol, min(amount, self.base_amount(symbol))))
        order = self._settle(self.exchange.create_market_sell_order(symbol, amount), symbol)
        price = float(order["average"])
        fee = self._fee_in_quote(order, self.cfg.quote, price)
        log.info("LIVE SELL %s: %s", symbol, order.get("id"))
        return Fill(float(order["filled"]), price, float(order.get("cost") or 0.0) - fee, fee)


def make_exchange(cfg: Config) -> ccxt.Exchange:
    klass = getattr(ccxt, cfg.exchange)
    params = {"enableRateLimit": True}
    if cfg.mode == "live":
        params.update(apiKey=cfg.api_key, secret=cfg.api_secret)
    exchange = klass(params)
    exchange.load_markets()
    return exchange


def make_broker(cfg: Config, paper_balances: dict | None = None) -> Broker:
    exchange = make_exchange(cfg)
    if cfg.mode == "live":
        return LiveBroker(cfg, exchange)
    return PaperBroker(cfg, exchange, paper_balances)
