#!/usr/bin/env bash
# Install GrgTrading as an always-on systemd service on Raspberry Pi OS (64-bit) or Debian.
# Usage (from the repo folder):  bash deploy/install-pi.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
USER_NAME="$(id -un)"
cd "$APP_DIR"

if [ "$(uname -m)" != "aarch64" ] && [ "$(uname -m)" != "x86_64" ]; then
  echo "Warning: $(uname -m) detected. Use the 64-bit OS, otherwise pandas/scikit-learn must compile for hours."
fi

echo "==> Installing system packages"
sudo apt-get update -qq
sudo apt-get install -y -qq python3-venv python3-pip

echo "==> Creating virtual environment and installing dependencies (can take 10-20 min on a Pi Zero)"
[ -d venv ] || python3 -m venv venv
venv/bin/pip install -q --upgrade pip
venv/bin/pip install -r requirements.txt

if [ ! -f .env ]; then
  cp .env.example .env
  echo "==> Created .env in paper mode. Edit it with: nano .env"
fi

echo "==> Installing systemd service 'grgtrading'"
sudo tee /etc/systemd/system/grgtrading.service >/dev/null <<EOF
[Unit]
Description=GrgTrading AI trading bot
After=network-online.target
Wants=network-online.target

[Service]
User=${USER_NAME}
WorkingDirectory=${APP_DIR}
ExecStart=${APP_DIR}/venv/bin/python -m grgtrading run
Restart=always
RestartSec=30
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable grgtrading >/dev/null

total_mb=$(free -m | awk '/^Mem:/ {m=$2} /^Swap:/ {s=$2} END {print m+s}')
if [ "$total_mb" -lt 1000 ]; then
  echo "Note: RAM + swap is only ${total_mb} MB. If the bot gets killed while retraining, add swap (see README)."
fi

cat <<MSG

Done. Next steps:
  1. nano .env                         (settings; paper mode by default)
  2. venv/bin/python -m grgtrading check
  3. sudo systemctl start grgtrading   (starts now and on every boot)
  4. journalctl -u grgtrading -f       (live log, Ctrl+C to exit)
  Status:  venv/bin/python -m grgtrading status
  Stop:    sudo systemctl stop grgtrading
MSG
