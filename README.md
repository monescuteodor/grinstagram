# GrgTrading

Bot de trading crypto bazat pe AI, făcut să ruleze 24/7. Folosește un model de
machine learning (gradient boosting) antrenat pe indicatori tehnici, cu
management strict al riscului, și poate tranzacționa pe orice exchange suportat
de [ccxt](https://github.com/ccxt/ccxt) (Binance, Kraken, Bybit, OKX, ...).

> **Atenție, citește înainte de a pune bani reali.**
> Niciun bot nu garantează profit. Majoritatea strategiilor automate pierd bani
> după comisioane. Botul pornește implicit în modul **paper** (bani simulați pe
> prețuri reale). Rulează mai întâi `backtest`, apoi lasă-l câteva săptămâni în
> paper trading, și doar dacă rezultatele sunt bune treci pe `live` cu o sumă
> pe care îți permiți să o pierzi în întregime.

## Cum funcționează

1. **Date**: descarcă lumânări OHLCV (implicit 1h) pentru fiecare pereche din `SYMBOLS`.
2. **Features**: randamente pe mai multe orizonturi, RSI, MACD, Bollinger, ATR,
   volum, trend EMA, volatilitate, ora din zi (`grgtrading/features.py`).
3. **Model AI** (`grgtrading/model.py`): un `HistGradientBoostingClassifier`
   estimează probabilitatea ca prețul să crească în următoarele 6 lumânări
   suficient cât să acopere comisioanele. Se reantrenează automat la fiecare 12h.
4. **Validare anti-overfitting**: înainte de fiecare utilizare, modelul e testat
   walk-forward pe date pe care nu le-a văzut. Dacă semnalele lui nu bat clar
   hazardul (în ansamblu *și* în majoritatea perioadelor), botul **nu deschide
   poziții noi** cu el. Mai bine stă pe loc decât să tranzacționeze pe zgomot.
5. **Decizie**: cumpără (doar long, spot, fără levier) când probabilitatea
   ≥ `BUY_THRESHOLD`; vinde când scade sub `SELL_THRESHOLD`.
6. **Risc** (`grgtrading/risk.py`):
   - mărimea poziției e calculată ca un stop atins să piardă ~1% din capital;
   - stop-loss și take-profit bazate pe ATR, cu trailing stop;
   - maxim `MAX_POSITION_PCT` din capital într-o poziție, maxim `MAX_OPEN_POSITIONS` poziții;
   - pierdere zilnică > 5% → nicio intrare nouă până a doua zi (UTC);
   - drawdown > 20% de la vârf → **kill switch**: închide tot și se oprește.
7. **24/7**: bucla reîncearcă automat la erori de rețea/exchange (cu backoff),
   starea e salvată pe disc după fiecare tranzacție, iar Docker repornește
   containerul dacă se oprește.

## Pornire rapidă

```bash
cp .env.example .env          # editează setările
pip install -r requirements.txt

python -m grgtrading backtest # testează strategia pe ~1 an de date istorice
python -m grgtrading run      # pornește botul (paper trading implicit)
python -m grgtrading status   # capital, poziții deschise, ultimele tranzacții
```

### Rulare 24/7 cu Docker (recomandat, pe un VPS)

```bash
cp .env.example .env
docker compose up -d --build
docker compose logs -f        # vezi ce face
python -m grgtrading status   # sau: docker compose exec bot python -m grgtrading status
```

`restart: unless-stopped` îl repornește automat după crash sau reboot.
Datele (stare, model, jurnal tranzacții, log-uri) stau în `./data`.

### Trecerea pe bani reali

1. Creează pe exchange o cheie API **doar cu drept de trading, fără drept de
   retragere (withdraw)**, și restricționează-o la IP-ul serverului.
2. În `.env`:
   ```
   MODE=live
   API_KEY=...
   API_SECRET=...
   LIVE_CONFIRM=I_UNDERSTAND_THE_RISKS
   ```
3. Pune în cont doar suma pe care vrei s-o riște botul.

Stop-loss-urile sunt gestionate de bot (verificate la fiecare `POLL_SECONDS`),
nu ca ordine pe exchange, deci dacă serverul e oprit, pozițiile nu sunt protejate.

## Notificări Telegram (opțional)

Creează un bot cu [@BotFather](https://t.me/BotFather), pune `TELEGRAM_TOKEN` și
`TELEGRAM_CHAT_ID` în `.env` și vei primi mesaj la fiecare cumpărare/vânzare,
la erori repetate și la kill switch.

## Setări principale

| Variabilă | Implicit | Ce face |
|---|---|---|
| `MODE` | `paper` | `paper` sau `live` |
| `EXCHANGE` | `binance` | orice id ccxt |
| `SYMBOLS` | `BTC/USDT,ETH/USDT` | perechi tranzacționate (aceeași monedă de cotare) |
| `TIMEFRAME` | `1h` | intervalul lumânărilor |
| `BUY_THRESHOLD` / `SELL_THRESHOLD` | `0.60` / `0.45` | praguri de probabilitate |
| `RISK_PER_TRADE` | `0.01` | % din capital pierdut dacă se atinge stop-ul |
| `MAX_DRAWDOWN_PCT` | `0.20` | pragul kill switch-ului |
| `DAILY_LOSS_LIMIT_PCT` | `0.05` | pauză pentru restul zilei |

Lista completă: `grgtrading/config.py` și `.env.example`.

## Teste

```bash
pip install -r requirements-dev.txt
pytest
```

## Structură

```
grgtrading/
  config.py     setări din .env
  features.py   indicatori tehnici + etichete de antrenare
  model.py      modelul AI și validarea walk-forward
  risk.py       mărimea pozițiilor, stop-uri, kill switch
  broker.py     paper trading și ordine reale prin ccxt
  bot.py        bucla 24/7
  backtest.py   backtest walk-forward cu comisioane
  storage.py    starea botului și jurnalul tranzacțiilor (SQLite)
  notify.py     notificări Telegram
```
