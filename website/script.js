(() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- Mobile menu ----------
  const nav = document.querySelector(".nav");
  const toggle = document.querySelector(".nav-toggle");
  toggle.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
  });
  document.querySelectorAll(".nav-links a").forEach((a) =>
    a.addEventListener("click", () => {
      nav.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    })
  );

  // ---------- Reveal on scroll ----------
  const reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !reduceMotion) {
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("visible");
          io.unobserve(e.target);
        }
      }),
      { threshold: 0.15 }
    );
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add("visible"));
  }

  // ---------- Results bars ----------
  const results = document.querySelectorAll(".result");
  const maxVal = Math.max(...[...results].flatMap((r) => [+r.dataset.bot, +r.dataset.hold]));
  const fmt = (v) => (v > 0 ? "+" : "") + v.toFixed(2) + "%";
  const fillBars = () => results.forEach((r) => {
    const bot = r.querySelector(".bot");
    const hold = r.querySelector(".hold");
    bot.dataset.label = fmt(+r.dataset.bot);
    hold.dataset.label = fmt(+r.dataset.hold);
    bot.style.width = (+r.dataset.bot / maxVal) * 85 + "%";
    hold.style.width = (+r.dataset.hold / maxVal) * 85 + "%";
  });
  const resultsBox = document.querySelector(".results");
  if ("IntersectionObserver" in window && !reduceMotion) {
    new IntersectionObserver((entries, obs) => {
      if (entries[0].isIntersecting) { fillBars(); obs.disconnect(); }
    }, { threshold: 0.3 }).observe(resultsBox);
  } else {
    fillBars();
  }

  // ---------- Copy buttons ----------
  document.querySelectorAll(".copy").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const text = btn.parentElement.querySelector("code").innerText;
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = "Copied";
      } catch {
        btn.textContent = "Select & copy";
      }
      setTimeout(() => (btn.textContent = "Copy"), 1600);
    })
  );

  document.getElementById("year").textContent = new Date().getFullYear();

  // ---------- Animated candlestick chart ----------
  const canvas = document.getElementById("chart");
  const ctx = canvas.getContext("2d");
  const css = getComputedStyle(document.documentElement);
  const GREEN = css.getPropertyValue("--accent").trim();
  const RED = css.getPropertyValue("--red").trim();
  const BLUE = css.getPropertyValue("--accent-2").trim();
  const N = 48;
  let candles = [];
  let price = 82000;

  function nextCandle() {
    const open = price;
    const close = open * (1 + (Math.random() - 0.48) * 0.012);
    const high = Math.max(open, close) * (1 + Math.random() * 0.004);
    const low = Math.min(open, close) * (1 - Math.random() * 0.004);
    price = close;
    // Occasional "AI buy signal" marker on a strong green candle
    const signal = close > open * 1.004 && Math.random() < 0.35;
    return { open, close, high, low, signal };
  }
  for (let i = 0; i < N; i++) candles.push(nextCandle());

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function draw() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    const hi = Math.max(...candles.map((c) => c.high));
    const lo = Math.min(...candles.map((c) => c.low));
    const pad = 16;
    const y = (v) => pad + (1 - (v - lo) / (hi - lo || 1)) * (h - pad * 2);
    const step = w / N;
    const body = Math.max(2, step * 0.55);

    // grid
    ctx.strokeStyle = "rgba(139,155,176,0.08)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const gy = (h / 4) * i;
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
    }

    // moving average
    ctx.strokeStyle = BLUE;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    candles.forEach((c, i) => {
      const win = candles.slice(Math.max(0, i - 9), i + 1);
      const ma = win.reduce((s, k) => s + k.close, 0) / win.length;
      const x = i * step + step / 2;
      i ? ctx.lineTo(x, y(ma)) : ctx.moveTo(x, y(ma));
    });
    ctx.stroke();
    ctx.globalAlpha = 1;

    // candles
    candles.forEach((c, i) => {
      const x = i * step + step / 2;
      const up = c.close >= c.open;
      ctx.strokeStyle = ctx.fillStyle = up ? GREEN : RED;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y(c.high)); ctx.lineTo(x, y(c.low)); ctx.stroke();
      const top = y(Math.max(c.open, c.close));
      const bh = Math.max(1.5, Math.abs(y(c.open) - y(c.close)));
      ctx.fillRect(x - body / 2, top, body, bh);
      if (c.signal) {
        const my = y(c.low) + 12;
        ctx.fillStyle = BLUE;
        ctx.beginPath(); ctx.moveTo(x, my - 5); ctx.lineTo(x - 5, my + 4); ctx.lineTo(x + 5, my + 4); ctx.closePath(); ctx.fill();
      }
    });

    // last price line
    const last = candles[candles.length - 1].close;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "rgba(230,237,243,0.35)";
    ctx.beginPath(); ctx.moveTo(0, y(last)); ctx.lineTo(w, y(last)); ctx.stroke();
    ctx.setLineDash([]);
  }

  window.addEventListener("resize", resize);
  resize();
  if (!reduceMotion) {
    setInterval(() => {
      candles.push(nextCandle());
      candles = candles.slice(-N);
      draw();
    }, 1400);
  }

  // ---------- Terminal log ----------
  const term = document.getElementById("term");
  const lines = [
    ["", "Started in PAPER mode on binance BTC/USDT, SOL/USDT [1h]"],
    ["", "Retrained BTC/USDT: edge -0.049, positive_folds 2/3"],
    ["warn", "BTC/USDT model shows no reliable edge; waiting"],
    ["ok", "Retrained SOL/USDT: edge +0.044, positive_folds 3/4, tradeable"],
    ["", "Heartbeat: equity 50.00 USDT, open positions: none"],
    ["buy", "BUY SOL/USDT 0.0569 @ 109.95 (p=0.63, stop 106.80)"],
    ["", "Heartbeat: equity 50.04 USDT, open positions: SOL/USDT"],
    ["", "Heartbeat: equity 50.11 USDT, open positions: SOL/USDT"],
    ["ok", "SELL SOL/USDT @ 112.40 (take_profit) PnL +0.12 USDT"],
    ["", "Heartbeat: equity 50.12 USDT, open positions: none"],
  ];
  const time = (i) => {
    const m = 53 + i;
    return `12:${String(m % 60).padStart(2, "0")}`;
  };
  let li = 0;
  function addLine() {
    const [cls, text] = lines[li % lines.length];
    const row = document.createElement("div");
    row.innerHTML = `<span class="muted">${time(li)}</span> <span class="${cls}"></span>`;
    row.lastElementChild.textContent = text;
    term.appendChild(row);
    while (term.children.length > 7) term.removeChild(term.firstChild);
    li++;
  }
  if (reduceMotion) {
    for (let i = 0; i < 7; i++) addLine();
  } else {
    addLine();
    setInterval(addLine, 1800);
  }
})();
