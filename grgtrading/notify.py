"""Optional Telegram notifications (set TELEGRAM_TOKEN and TELEGRAM_CHAT_ID)."""
from __future__ import annotations

import json
import logging
import urllib.request

from .config import Config

log = logging.getLogger(__name__)


class Notifier:
    def __init__(self, cfg: Config):
        self.token, self.chat_id = cfg.telegram_token, cfg.telegram_chat_id

    def send(self, text: str) -> None:
        log.info(text)
        if not (self.token and self.chat_id):
            return
        try:
            req = urllib.request.Request(
                f"https://api.telegram.org/bot{self.token}/sendMessage",
                data=json.dumps({"chat_id": self.chat_id, "text": f"[GrgTrading] {text}"}).encode(),
                headers={"Content-Type": "application/json"})
            urllib.request.urlopen(req, timeout=10).read()
        except Exception as exc:  # notifications must never crash the bot
            log.warning("Telegram notification failed: %s", exc)
